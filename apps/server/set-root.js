const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const ws = await p.workspace.findFirst({ where: { slug: 'default' } });
  if (!ws) { console.log('workspace not found'); process.exit(1); }

  const admin = await p.user.findUnique({ where: { email: 'admin@furm.com' } });
  if (!admin) { console.log('admin user not found'); process.exit(1); }

  // 把旧 owner 降为 editor
  const old = await p.workspaceMember.findFirst({
    where: { workspaceId: ws.id, role: 'owner', userId: { not: admin.id } }
  });
  if (old) {
    await p.workspaceMember.updateMany({
      where: { workspaceId: ws.id, userId: old.userId },
      data: { role: 'editor' },
    });
    console.log('旧 owner ' + old.userId + ' 已降为 editor');
  }

  // 把 admin 设为 owner
  await p.workspaceMember.updateMany({
    where: { workspaceId: ws.id, userId: admin.id },
    data: { role: 'owner' },
  });

  // 同步 RBAC：admin → 管理员
  const roles = await p.role.findMany({ where: { workspaceId: ws.id } });
  await p.userRole.deleteMany({
    where: { userId: admin.id, roleId: { in: roles.map(r => r.id) } }
  });
  const adminRole = roles.find(r => r.name === '管理员');
  if (adminRole) {
    await p.userRole.create({ data: { userId: admin.id, roleId: adminRole.id } });
  }

  console.log('完成：admin@furm.com 现在是默认空间的 root');
  await p.$disconnect();
})().catch(e => {
  console.error(e.message);
  process.exit(1);
});
