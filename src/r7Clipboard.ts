import { createMapMdGuard, createMapMdSubtreeProof, createMapMdPastePatches,
  type InsertSubtreeNode, type MapMdSubtreeLimits, type MapMdSubtreeProof, type MapMdGuard, type MapMdPatchResult, type ThoughtMap } from '@thoughtforge/core';

export type R7PasteCommand = Readonly<{ type: 'node.pasteSubtreeAsLastChild'; parentId: string;
  expectedChildCount: number; copyToken: string; clipboardReceipt: string; mountEpoch: number }>;
export type R7Client = { readonly generation: number };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const r7Keys = (v: unknown, keys: string): v is Record<string, unknown> => object(v) && Object.keys(v).sort().join(',') === keys;
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
export function isR7Paste(v: unknown): v is R7PasteCommand {
  return r7Keys(v,'clipboardReceipt,copyToken,expectedChildCount,mountEpoch,parentId,type') && v.type==='node.pasteSubtreeAsLastChild' &&
    id(v.parentId) && typeof v.copyToken==='string' && /^[a-f0-9]{64}$/.test(v.copyToken) &&
    typeof v.clipboardReceipt==='string' && /^[a-f0-9]{64}$/.test(v.clipboardReceipt) && positive(v.mountEpoch) &&
    Number.isSafeInteger(v.expectedChildCount) && (v.expectedChildCount as number)>=0;
}
type Copy = { token: string; effectId: string; proof: MapMdSubtreeProof; text: string; ack: boolean; written: boolean; live: () => boolean };
type Receipt = { token: string; requestId: string; command: Omit<R7PasteCommand,'clipboardReceipt'>; guard: MapMdGuard; copy: Copy; live: () => boolean };
type Session = { generation: number; used: Set<string>; saturated: boolean; parents: Map<string, object>; mount: number; copy?: Copy; receipt?: Receipt };
/** Limits are supplied by the owning host contract. No product defaults live here. */
export class R7Clipboard {
  private readonly sessions = new WeakMap<R7Client,Session>();
  readonly limits: MapMdSubtreeLimits;
  private readonly opaque: () => string;
  constructor(limits: MapMdSubtreeLimits, opaque: () => string) { this.limits=limits;this.opaque=opaque; }
  private session(client: R7Client): Session {
    let s=this.sessions.get(client);
    if(!s || s.generation!==client.generation){s={generation:client.generation,used:new Set(),saturated:false,parents:new Map(),mount:0};this.sessions.set(client,s)}
    return s;
  }
  consume(client: R7Client, requestId: string): boolean {
    const s=this.session(client);if(!id(requestId)||s.saturated||s.used.has(requestId))return false;
    if(s.used.size>=10000){s.saturated=true;return false;}s.used.add(requestId);return true;
  }
  consumed(client: R7Client, requestId: string): boolean { const s=this.session(client);return s.saturated||s.used.has(requestId); }
  limitRejection(client: R7Client, requestId: string): boolean { const s=this.session(client);return s.saturated&&!s.used.has(requestId); }
  parentAdmission(client: R7Client, requestId: string): ()=>boolean {
    const s=this.session(client),mount=s.mount,token={};s.parents.set(requestId,token);
    return ()=>this.session(client)===s&&s.mount===mount&&s.parents.get(requestId)===token;
  }
  finishParent(client: R7Client, requestId: string): void {this.session(client).parents.delete(requestId);}
  continuation(client: R7Client, requestId: string): boolean {
    const s=this.session(client);if(s.used.has(requestId))return s.receipt?.requestId===requestId;
    return this.consume(client,requestId);
  }
  mount(client: R7Client, mount: unknown): boolean {
    const s=this.session(client);if(!positive(mount)||mount<s.mount)return false;
    if(mount>s.mount){s.mount=mount;s.copy=undefined;s.receipt=undefined;s.parents.clear()}return true;
  }
  invalidate(client: R7Client): void {const s=this.session(client);s.copy=undefined;s.receipt=undefined}
  cancel(client: R7Client, requestId: string): void {if(!id(requestId))return;const s=this.session(client);if(!s.used.has(requestId))this.consume(client,requestId);s.parents.delete(requestId);s.copy=undefined;s.receipt=undefined}
  async copy(client: R7Client, raw: string, map: ThoughtMap, value: unknown, effectId: string,
    live: () => boolean, write: (text: string)=>Promise<void>) {
    const s=this.session(client);s.copy=undefined;s.receipt=undefined;
    if(!r7Keys(value,'baseHash,mountEpoch,nodeId,text')||!id(value.nodeId)||typeof value.text!=='string'||value.mountEpoch!==s.mount||!s.mount) return {ok:false as const,reason:'invalid-copy'};
    const source=map.nodesById[value.nodeId];if(!source)return {ok:false as const,reason:'unknown-target'};
    // Saved model only; input overlays and sender trees are never promoted.
    const root: InsertSubtreeNode={text:source.text,children:[]}, pending=[{source,target:root,depth:1}],seen=new Set<string>();
    while(pending.length){const {source,target,depth}=pending.pop()!;if(seen.has(source.id))return {ok:false as const,reason:'invalid-source'};seen.add(source.id);if(seen.size>this.limits.maxNodes||depth>this.limits.maxDepth)return {ok:false as const,reason:'payload-limit'};
      for(const childId of source.children){const child=map.nodesById[childId];if(!child)return {ok:false as const,reason:'invalid-source'};
        const next: InsertSubtreeNode={text:child.text,children:[]};(target.children as InsertSubtreeNode[]).push(next);pending.push({source:child,target:next,depth:depth+1})}}
    const result=createMapMdSubtreeProof(raw,source.id,root,this.limits);
    if(!result.ok)return result;
    if(value.baseHash!==result.proof.baseHash)return {ok:false as const,reason:'stale'};
    const lines: string[]=[],todo=[{node:root,depth:0}];
    while(todo.length){const {node,depth}=todo.pop()!;lines.push('  '.repeat(depth)+'- '+node.text.replace(/\s+/g,' ').trim().replace(/^([#>+*\[\]-])/u,'\\$1'));
      for(let i=node.children.length-1;i>=0;i--)todo.push({node:node.children[i]!,depth:depth+1})}
    if(lines.join('\n')!==value.text)return {ok:false as const,reason:'clipboard-payload-mismatch'};
    const copy: Copy={token:this.opaque(),effectId,proof:result.proof,text:value.text,ack:false,written:false,live};s.copy=copy;
    await write(copy.text);
    if(!live()||s.copy!==copy){if(s.copy===copy)s.copy=undefined;return {ok:false as const,reason:'stale'}}
    copy.written=true;return {ok:true as const,copyToken:copy.token};
  }
  ack(client: R7Client, token: unknown, effectId: unknown, mount: unknown): boolean {
    const s=this.session(client),c=s.copy;if(!c||!c.written||token!==c.token||effectId!==c.effectId||mount!==s.mount||!c.live())return false;
    c.ack=true;return true;
  }
  async read(client: R7Client, requestId: string, value: unknown, raw: string,
    live: ()=>boolean, read: ()=>Promise<string>, settle: <T>(finish: ()=>T)=>Promise<T> = async finish=>finish()) {
    const s=this.session(client),copy=s.copy;
    if(!(r7Keys(value,'baseHash,copyToken,expectedChildCount,mountEpoch,parentId')||r7Keys(value,'baseHash,copyToken,eventText,expectedChildCount,mountEpoch,parentId')) || !copy?.ack || copy.token!==value.copyToken ||
      value.mountEpoch!==s.mount || value.baseHash!==copy.proof.baseHash || !id(value.parentId) || !Number.isSafeInteger(value.expectedChildCount) || (value.expectedChildCount as number)<0 || !copy.live() || !live())return {ok:false as const,reason:'copy-expired'};
    if('eventText' in value && (typeof value.eventText!=='string'||value.eventText!==copy.text))return {ok:false as const,reason:'clipboard-mismatch'};
    const guard=createMapMdGuard(raw,value.parentId);if(!guard.ok)return guard;
    if(guard.guard.baseHash!==value.baseHash)return {ok:false as const,reason:'stale'};
    const mount=s.mount,parentId=value.parentId,expectedChildCount=value.expectedChildCount as number;
    let text: string;
    try {text=await read();}catch{return {ok:false as const,reason:'clipboard-read-failed'}} // One OS read, outside the document queue.
    return settle(()=>{
      if(this.session(client)!==s||s.mount!==mount||!live()||!copy.live()||s.copy!==copy||text!==copy.text)return {ok:false as const,reason:'clipboard-mismatch'};
      const r: Receipt={token:this.opaque(),requestId,command:{type:'node.pasteSubtreeAsLastChild',parentId,expectedChildCount,copyToken:copy.token,mountEpoch:mount},guard:guard.guard,copy,live};
      s.receipt=r;
      return {ok:true as const,clipboardReceipt:r.token,command:{...r.command,clipboardReceipt:r.token},guard:r.guard};
    });
  }
  admission(client: R7Client, requestId: string, command: unknown, guard: unknown): (()=>boolean) | undefined {
    const s=this.session(client),r=s.receipt;
    if(!isR7Paste(command)||!r||requestId!==r.requestId||command.clipboardReceipt!==r.token||
      Object.entries(r.command).some(([k,v])=>command[k as keyof R7PasteCommand]!==v)||
      !r7Keys(guard,'baseHash,targets')||guard.baseHash!==r.guard.baseHash||!Array.isArray(guard.targets)||guard.targets.length!==1||
      !r7Keys(guard.targets[0],'kind,nodeId,parentRawHash,titleSource')||Object.entries(r.guard.targets[0]!).some(([k,v])=>(guard.targets as Record<string,unknown>[])[0]![k]!==v))return undefined;
    s.receipt=undefined; // One continuation only; duplicates cannot queue or revive a receipt.
    return ()=>r.live()&&r.copy.live()&&s.copy===r.copy&&s.mount===command.mountEpoch;
  }
  patches(client: R7Client, raw: string, command: R7PasteCommand, guard: unknown): MapMdPatchResult {
    const s=this.session(client),copy=s.copy;
    if(!copy?.ack||copy.token!==command.copyToken||!copy.live()||s.mount!==command.mountEpoch)return {ok:false,reason:'stale-proof'};
    return createMapMdPastePatches(raw,{type:command.type,parentId:command.parentId,expectedChildCount:command.expectedChildCount,
      payloadHash:copy.proof.payloadHash,proof:copy.proof},guard,this.limits);
  }
}
