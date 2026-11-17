import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {composeEntries,loadOverlayPatches} from '@deepseek-ai/dsh-app-boot';
const root=fileURLToPath(new URL('../../../../',import.meta.url)),dir=fileURLToPath(new URL('../',import.meta.url)),archive=JSON.parse(await readFile(join(root,'.artifacts/latest-ui-package.json'),'utf8')).archive;
function tar(args){const r=spawnSync('tar',args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout;}
test('archive is independent, browser-safe and never embeds SDK or private artifacts',async()=>{
 const files=tar(['-tf',archive]).trim().split(/\r?\n/);assert.ok(files.includes('package/LICENSE'));assert.ok(files.includes('package/lib/client.js'));assert.ok(files.includes('package/lib/typert.host.js'));assert.ok(files.includes('package/lib/typert.remote-client.js'));
 assert.ok(files.every(p=>!/(node_modules|\.artifacts|tests\/|scripts\/|src\/|\.meta\.json|tsbuildinfo)/.test(p)));
 const m=JSON.parse(tar(['-xOf',archive,'package/package.json']));
 assert.equal(m.name,'@dannyzhou/dsh-codex-bridge-ui');
 assert.equal(m.version,JSON.parse(await readFile(join(dir,'package.json'),'utf8')).version);
 assert.equal(m.license,'MIT');
 assert.equal(m.publishConfig.access,'public');
 assert.deepEqual(m.dependencies,{zod:'4.6.5'});
 assert.equal(m.peerDependencies['@dannyzhou/dsh-codex-bridge'],'0.0.10');
 assert.equal(m.peerDependencies['dsh-codex-bridge'],undefined);
 assert.equal(m.peerDependencies['@deepseek-ai/cordis'],'4.1.0');
 for(const[k,v]of Object.entries(m.peerDependencies))if(k.startsWith('@deepseek-ai/dsh-'))assert.equal(v,'0.2.2-rc.3');
 assert.equal(m.dsh.client.platform,'web');
 assert.equal(m.dsh.bundle.patch,'./cordis.patch.yml');
 const patch=join(dir,m.dsh.bundle.patch);
 assert.equal(tar(['-xOf',archive,'package/cordis.patch.yml']),await readFile(patch,'utf8'));
 assert.deepEqual(composeEntries([loadOverlayPatches(m.name,patch)]),[{id:'dsh-codex-bridge-ui',name:m.name}]);
 for(const path of [m.main,m.types,...Object.values(m.exports).flatMap(entry=>typeof entry==='string'?[entry]:Object.values(entry))]){
  assert.ok(files.includes('package/'+path.slice(2)),'Missing archive entry '+path);
 }
 const client=tar(['-xOf',archive,'package/lib/client.js']);assert.ok(client.startsWith('window.__ModuleLoader__.load'));assert.ok(!/require\(["'](?:node:|fs|child_process|path|@deepseek-ai\/dsh-session|@deepseek-ai\/dsh-workspace|dsh-codex-bridge)["']\)/.test(client));
 assert.ok(files.includes('package/lib/setup.js'));
 assert.ok(files.includes('package/lib/native-confirm.js'));
 assert.doesNotMatch(client,/EncodedCommand|WindowsPowerShell|node:child_process/);
 let registration;
 runInNewContext(client,{window:{__ModuleLoader__:{load(value){registration=value;}}}});
 assert.equal(registration?.id,m.name);
 assert.equal(typeof registration.factory,'function');
 const externals=[...new Set([...client.matchAll(/require\("([^\"]+)"\)/g)].map(m=>m[1]))];assert.deepEqual(externals.sort(),['@deepseek-ai/dsh-client-ui-primitives','react','react/jsx-runtime'].sort());
 assert.equal(client,await readFile(join(dir,'lib/client.js'),'utf8'));const meta=JSON.parse(await readFile(join(dir,'lib/client.meta.json'),'utf8'));assert.ok(Object.keys(meta.inputs).every(p=>!/(node_modules[\\/]react[\\/]|node_modules[\\/]@deepseek-ai[\\/]cordis[\\/])/.test(p)));
});
