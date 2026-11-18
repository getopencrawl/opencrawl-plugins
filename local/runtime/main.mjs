import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {binding,enrollment,atomic} from './io.mjs';
import {collect,handoff,flush,observe} from './capture.mjs';
import {start,search,suggest} from './lifecycle.mjs';
export async function invoke(root,action,event,output=process.stdout){
  const b=binding(root);enrollment(b);
  if(!event||typeof event!=='object'||Array.isArray(event))throw Error('Invalid hook input');
  let result;
  if(action==='observe'){await observe(b,event);return;}
  else if(action==='start')result=await start(b,event);
  else if(action==='search')result=search(b,event);
  else if(action==='suggest'){
    const suggestion=await suggest(b,event);
    if(suggestion?.output){await new Promise((resolve,reject)=>output.write(JSON.stringify(suggestion.output)+'\n',error=>error?reject(error):resolve()));suggestion.handoff();}
    await suggestion?.flush();return;
  }else if(action==='capture'){
    if(b.captureMode==='daemon')result=handoff(b,event);
    else{result=await collect(b,event);if(result.selected){try{result.uploaded=await flush(b);}catch{result.pendingUpload=true;}}}
    atomic(join(b.profile,'plugin-state',b.key,'status.json'),{at:new Date().toISOString(),harness:b.client,...result});return;
  }else throw Error('Unsupported lifecycle action');
  if(result)output.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]||process.versions.bun&&import.meta.main){
  const args=process.argv.slice(2);
  try{
    if(args.length!==4||args[0]!=='--root'||args[2]!=='--action')throw Error('Explicit root and action required');
    const root=args[1],action=args[3];
    let bytes=Buffer.alloc(0);
    const timer=setTimeout(()=>{process.stderr.write('OpenCrawl hook input timed out\n');process.exit(0);},1000);timer.unref();
    for await(const chunk of process.stdin){bytes=Buffer.concat([bytes,Buffer.from(chunk)]);if(bytes.length>8*1024*1024)throw Error('Hook input exceeds limit');}
    clearTimeout(timer);await invoke(root,action,JSON.parse(bytes.toString('utf8')));
  }catch(error){
    // Report only an error class, never a response body, credential or content.
    process.stderr.write('OpenCrawl lifecycle hook unavailable: '+(error?.name??'Error')+'\n');process.exitCode=0;
  }
}
