// Local-only masking. UUIDs, hashes and ordinary identifiers are not secrets.
const patterns=[
  /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END[ A-Z0-9_-]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{82}|glpat-[A-Za-z0-9_-]{20,255}|npm_[A-Za-z0-9]{36})\b/g,
  /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g,
  /\bA3T[A-Z0-9]{17}\b/g,
  /\bAIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g,
  /\bya29\.[A-Za-z0-9_-]{20,}/g,
  /\b(?:sk-ant-(?:api03|admin01)-[A-Za-z0-9_-]{20,}|sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|crsr_[a-f0-9]{64}|oc[ac]1_[a-f0-9]{64})\b/g,
  /\b(?:xox[baprse]-[A-Za-z0-9-]{20,}|xapp-\d-[A-Za-z0-9-]{20,}|(?:sk|rk)_(?:live|test|prod)_[A-Za-z0-9]{10,})\b/g,
  /\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}/g,
  /(?:https?:\/\/)?hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/+_-]{20,}/g,
  /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/g,
  /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g,
  /\bkey-[a-f0-9]{32}\b/g,
  /\b(?:hvs|hvb)\.[A-Za-z0-9_-]{20,}/g,
  /\b(?:dop_v1_|doo_v1_|dor_v1_)[a-f0-9]{64}\b/g,
  /\b(?:hf_[A-Za-z0-9]{34}|AGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58})\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}={0,2}/g,
];
const secret=/^(?:(?:[a-z][a-z0-9]*[_-])*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|secret(?:[_-]?(?:key|access[_-]?key))?|client[_-]?secret|password|passwd|token)|authorization|x-api-key|x-amz-(?:signature|security-token))$/i;
const literal=s=>s.length>=4&&s!=='[REDACTED]'&&!/^(?:\$|%[A-Z_]+%|\{\{|<|process\.env\.|(?:os\.)?environ\b|import\.meta\.env\.)/.test(s)&&!/^(true|false|null|undefined)$/i.test(s);
export function redact(value,depth=0){
  if(depth>128)return '[REDACTED]';
  if(Array.isArray(value))return value.map(v=>redact(v,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[redact(k,depth+1),secret.test(k)&&typeof v==='string'&&literal(v)?'[REDACTED]':redact(v,depth+1)]));
  if(typeof value!=='string')return value;
  if(/^\s*[\[{]/.test(value)){try{const p=JSON.parse(value),r=redact(p,depth+1);if(JSON.stringify(p)!==JSON.stringify(r))return JSON.stringify(r);}catch{}}
  let text=value;for(const p of patterns)text=text.replace(p,'[REDACTED]');
  text=text.replace(/(\b(?:Bearer|Basic)[ \t]+)[A-Za-z0-9._~+\/-]{8,}=*/gi,'$1[REDACTED]');
  text=text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:)[^\s/@]+(@)/gi,'$1[REDACTED]$2');
  return text.replace(/(\b([A-Za-z][A-Za-z0-9_-]*)["']?[ \t]*(?:=|:)[ \t]*)(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)'|([^\s"'`,;&<>\[\]{}]+))/g,(all,prefix,name,double,single,bare)=>secret.test(name)&&literal(double??single??bare)?prefix+'"[REDACTED]"':all);
}
