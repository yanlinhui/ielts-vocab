import { hashPassword } from "../src/lib/auth";

// 生成 AUTH_PASSWORD_HASH。用法：
//   npm run auth:hash -- "你的密码"
//
// 输出整行直接贴进 .env / Vercel 环境变量。密码本身不会落盘到任何地方。

const password = process.argv[2];
if (!password) {
  console.error('用法：npm run auth:hash -- "密码"');
  process.exit(1);
}

console.log(hashPassword(password));
