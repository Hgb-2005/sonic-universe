'use strict';
// 打包后裁剪：删掉本应用用不到的 Electron 组件，减小安装包。
// dxcompiler.dll 只服务 WebGPU/D3D12 着色器编译，本项目用 WebGL + Canvas，不需要。
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const root = context.appOutDir;
  const removable = ['dxcompiler.dll'];
  let freed = 0;
  for (const name of removable) {
    const file = path.join(root, name);
    try {
      const size = fs.statSync(file).size;
      fs.rmSync(file, { force: true });
      freed += size;
      console.log(`[afterPack] removed ${name} (${(size / 1024 / 1024).toFixed(1)} MB)`);
    } catch {
      // 文件可能不存在：不同 Electron 版本组成不同，跳过即可
    }
  }
  if (freed) console.log(`[afterPack] freed ${(freed / 1024 / 1024).toFixed(1)} MB`);
};
