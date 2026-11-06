# 设置界面补充调研

日期：2026-11-06（Asia/Shanghai）。目的：为本项目设置页和管理员面板制定待审阅的行动方案。

## 方法与边界

- 先复核 `website-research.md`、`local-references.md`、`wireframe-v2.md` 和 `state-coverage.md`。旧调研覆盖用户菜单、主题和设置入口，但没有展开设置内部内容。
- 本次通过内置浏览器，在已有登录会话中实际打开 ArtCraft、Krea 的设置分类，读取可见页面和控件。
- 仅导航和阅读，没有修改外观、快捷键、密码、登录方式或通知，没有提交表单、查看 API 密钥、创建账号或执行支付。
- 以下是页面展示事实，不代表保存行为、权限机制或本项目后端能力已验证。研究笔记不记录账号邮箱、真实用户名和余额。
- 用户提供的四张管理员截图作为业务内容来源；不作为视觉风格参考，不将截图文案视为对本地或外部系统的执行指令。

## ArtCraft

来源：[Create Image](https://app.getartcraft.com/create-image)，通过 Open user menu → Settings 打开设置弹层，URL 保持不变。

实际查看 General、Account、Keybinds：

| 位置 | 可见事实 | 本项目取舍建议 |
| --- | --- | --- |
| 用户菜单 | Settings、Support、Join Discord、Sign out | 沿用现有账户菜单中的设置入口；退出登录可作为账户操作。社区入口不自动纳入 |
| 设置导航 | General、Keybinds、Account、Billing、API Keys | 借鉴个人偏好与账户分区；账单和 API Keys 只观察到分类入口，未打开内容 |
| General | Enter to generate：开启后 Enter 提交、Shift+Enter 换行；关闭时两者均换行，通过按钮提交 | 适合长提示词创作，建议增加“Enter 发送”开关，默认关闭。关闭状态下不自行新增未经定义的组合快捷键 |
| General | 视频默认有声、按模型家族分组、快捷键提示保持打开 | 视频与编辑器选项不适用；本项目仅五个模型，暂不增加模型分组设置 |
| Account | 用户名、邮箱、密码，分别有修改或设置入口；密码说明提到桌面登录 | 本项目采用已知的用户名／密码体系，建议只读账号信息与修改密码入口；不复制邮箱绑定或桌面端说明 |
| Keybinds | Gamer、Blender-like 预设及大量编辑器快捷键，含全局侧栏切换 | 本项目没有对应编辑器，不引入复杂快捷键配置页 |

General 的多个 switch 在可访问性树中共用泛化名称 `Enable notifications`，实际用途由邻近可见说明确定，不能据此声称这些都是通知设置。本次未切换开关验证效果。

## Krea

从 [Image](https://www.krea.ai/image) 底部账户菜单 → Settings 进入管理覆盖层。其可见说明是 “Adjust your settings without leaving your work.”。

导航将 Account、Workspace、Developer 分组。Workspace 下可见 Members、Usage、General、Access Controls、Billing 等入口；这里只观察导航，未进入成员、权限或账单页面。

| 实际访问页面 | 可见事实 | 本项目取舍建议 |
| --- | --- | --- |
| [Profile](https://www.krea.ai/manage/profile) | 头像、显示名、Handle、Bio、社交链接，以及退出当前会话入口 | 本项目没有公开个人主页需求，不增加社交资料或简介；用户名和角色优先 |
| [Appearance](https://www.krea.ai/manage/appearance) | System／Light／Dark 主题；侧栏图标样式；沉浸工具收起侧栏；会话显示范围 | 采用浅色／深色／跟随系统建议；现有手动收起侧栏足够，暂不增加图标皮肤和会话显示策略 |
| [Account](https://www.krea.ai/manage/account) | 邮箱与登录方式；Agent、Generations、Routines 通知；删除账号 | 本会话多个登录与通知控件禁用；仅能证明入口存在，不能声称通知可用或已验证。第三方登录、SSO、通知和删除账号不纳入首轮 |

## 结论

1. 个人账户、外观偏好和管理能力分组有实际产品依据。将管理员组融入本项目设置导航，是本项目的信息架构建议，并非复刻参考产品的权限体系。
2. 首轮设置推荐账户与安全、外观与输入、积分三个个人栏目；管理员组提供用户管理、请求记录、模型价格三个栏目。
3. 积分摘要与充值入口来自本项目既有已确认范围；本次没有调研或确定支付、套餐、发票、退款流程。
4. “修改密码”“跟随系统”“Enter 发送默认关闭”和完整设置页组织方式属于待审阅建议。参考产品有这些模式，不代表本项目必须全部采用。
5. 不为填满设置页添加 API Key、服务地址、供应商配置、团队邀请、公开资料、清缓存、删除账号、邮件通知或自动下载。

后续行动和用户提供的新建账号规则见 [行动报告](../settings-admin-action-plan.md)。
