import { setUserPassword } from './auth.js';

const usernames = process.argv.slice(2);
const password = process.env.ACCOUNT_PASSWORD;

if (usernames.length === 0 || !password) {
  console.error('Cách dùng: ACCOUNT_PASSWORD="..." npm run users:create -- username1 username2');
  process.exit(1);
}

for (const username of usernames) {
  const result = setUserPassword(username, password);
  console.log(`${result.created ? 'Đã tạo' : 'Đã cập nhật'} tài khoản: ${result.username}`);
}
