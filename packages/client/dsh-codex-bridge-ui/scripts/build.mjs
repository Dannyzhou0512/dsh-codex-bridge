/** Standalone companion build: public generator + externalized ModuleLoader factory. */
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator';
import { build } from 'esbuild';
const dir=resolve(dirname(fileURLToPath(import.meta.url)),'..'),root=resolve(dir,'../../..');
const manifest=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));
function tsc(config){const result=spawnSync(process.execPath,[join(dir,'node_modules/typescript/lib/tsc.js'),'-p',join(dir,config)],{cwd:dir,encoding:'utf8',windowsHide:true});if(result.status!==0)throw Error(result.stdout+result.stderr);}
const require = createRequire(join(dir,'package.json'));
const analysis={files:[],references:[{path:'./packages/client/dsh-codex-bridge-ui/tsconfig.host.json'}]};
for(const name of ['@deepseek-ai/dsh-typert-protocol','@deepseek-ai/cordis']){
 const sdk=dirname(require.resolve(name+'/package.json'));const meta=JSON.parse(await readFile(join(sdk,'package.json'),'utf8'));
 const file=join(sdk,'tsconfig.p11-analysis.json');
 await writeFile(file,JSON.stringify({compilerOptions:{target:'ES2023',module:'NodeNext',moduleResolution:'NodeNext',skipLibCheck:true,strict:true,noEmit:true},files:[meta.types]},null,2)+'\n');
 analysis.references.push({path:relative(root,file).replaceAll('\\','/')});
}
await writeFile(join(root,'tsconfig.host.json'),JSON.stringify(analysis,null,2)+'\n');
await mkdir(join(dir,'lib'),{recursive:true});tsc('tsconfig.host.json');
const artifacts=new WorkspaceTypertGenerator(root).generate([manifest.name],['host']);
if(artifacts.length!==1||!artifacts[0].remote)throw Error('Missing public Host/Remote generation');
const artifact=artifacts[0];await writeFile(join(dir,'lib/typert.host.js'),artifact.js);await writeFile(join(dir,'lib/typert.host.d.ts'),artifact.dts);
await writeFile(join(dir,'lib/typert.remote-client.js'),artifact.remote.js);await writeFile(join(dir,'lib/typert.remote-client.d.ts'),artifact.remote.dts);
await build({entryPoints:[join(dir,'src/index.ts'),join(dir,'src/shared.ts'),join(dir,'src/runtime.ts'),join(dir,'src/config.ts')],outdir:join(dir,'lib'),platform:'node',format:'esm',target:'es2023',bundle:false});
tsc('tsconfig.client.json');
const external=['react','react/jsx-runtime','@deepseek-ai/cordis','@deepseek-ai/dsh-client-ui-primitives'];
const client=await build({entryPoints:[join(dir,'src/client/index.tsx')],bundle:true,write:false,platform:'browser',jsx:'automatic',format:'cjs',target:'es2023',external,metafile:true});
if(Object.keys(client.metafile.inputs).some(p=>p.includes('/src/index.ts')&&!p.includes('/client/')))throw Error('Host code leaked into browser');
const body=client.outputFiles[0].text;
await writeFile(join(dir,'lib/client.js'),`window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${body}\nreturn module.exports;}});\n`);
await writeFile(join(dir,'lib/client.meta.json'),JSON.stringify(client.metafile,null,2));
console.log('P12 Host/Remote generated; client factory built with React and primitives externalized.');
