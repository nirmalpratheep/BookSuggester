const http = require('http');
const assert = require('assert');
const child = require('child_process');
const path = require('path');

// Start server in a child process
const serverPath = path.join(__dirname, '..', 'server.js');
const proc = child.spawn(process.execPath, [serverPath], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, USE_MOCK: 'true', PORT: '5001' } });

proc.stdout.on('data', d=>{ if(d.toString().includes('Server running')) runTest(); });

proc.stderr.on('data', d=>{ console.error('server err', d.toString()); });

function runTest(){
  const payload = JSON.stringify({ profile: { age:8, fiction_preference: 'both', interests:['space'] }, exclude_titles: [], max_results_per_category: 2 });
  const opts = { method: 'POST', hostname: 'localhost', port: 5001, path: '/api/recommend', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } };
  const req = http.request(opts, res=>{
    let data=''; res.on('data', c=> data+=c); res.on('end', ()=>{
      try{
        assert.equal(res.statusCode, 200);
        const json = JSON.parse(data);
        assert(json.metadata && json.results);
        console.log('TEST PASS');
        proc.kill();
      }catch(err){ console.error('TEST FAIL', err); proc.kill(); process.exit(1); }
    });
  });
  req.on('error', e=>{ console.error('req err', e); proc.kill(); process.exit(2); });
  req.write(payload); req.end();
}
