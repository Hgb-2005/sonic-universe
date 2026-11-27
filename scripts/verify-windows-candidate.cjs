'use strict';

const { spawnSync }=require('node:child_process');
const { existsSync }=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const product=require('../package.json').build.productName;
const candidate=path.resolve(process.env.SONIC_DESKTOP_EXECUTABLE||path.join(root,'release','win-unpacked',product+'.exe'));
const previous=process.env.SONIC_PREVIOUS_WINDOWS_INSTALLER;
const env={...process.env,SONIC_DESKTOP_EXECUTABLE:candidate};

function run(label,executable,args){
  console.log('\n[START] '+label);
  const result=spawnSync(executable,args,{cwd:root,env,stdio:'inherit',timeout:360000,windowsHide:true});
  if(result.error||result.status!==0){
    console.error('[FAIL] '+label+' · '+(result.error?.message||'exit '+result.status));
    return false;
  }
  console.log('[PASS] '+label);
  return true;
}

if(process.platform!=='win32'||!existsSync(candidate)){
  console.error('Expected a packaged Windows desktop EXE at '+candidate);
  process.exitCode=1;
}else{
  const node=(label,script,...args)=>[label,process.execPath,[path.join('scripts',script),...args]];
  const steps=[
    node('Chart timeout, companion outage, recovery','windows-candidate-failures.cjs'),
    node('Late lyrics, edited lyrics, and empty-track clearing','windows-candidate-lyrics.cjs'),
    node('Fresh-profile seek preview text and actual position (5 drags)','library-search-smoke.cjs','--packaged','--first-run-only','--repeat-first-run-seek'),
    node('Consecutive tracks and persisted queue recovery','queue-smoke.cjs','--packaged'),
    ['Isolated Windows clean install and overwrite with saved data','powershell.exe',[
      '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join('scripts','windows-candidate-install.ps1'),'-CandidateExe',candidate,
      ...(previous?['-PreviousInstaller',previous]:[]),
    ]],
  ];
  let passed=0;
  for(const step of steps)if(run(...step))passed++;
  console.log('\nCandidate checks passed '+passed+'/'+steps.length+' for '+candidate);
  process.exitCode=passed===steps.length?0:1;
}

