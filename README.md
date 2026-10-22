# 同桌 · 朋友德州

一个供好友使用的单房间德州扑克小游戏，支持最多 9 人通过浏览器联机。使用原生 HTML / CSS / JavaScript 和 Node.js，无第三方依赖，无需数据库或前端构建。

仅用于积分娱乐和学习，不提供充值、提现、奖金或筹码交易。

## 功能

- 每场初始 1000 分，固定盲注 10/20，支持无限注、All-in、边池和平局分池。
- 管理员管理牌局和访问口令；玩家凭名字和口令加入。
- 管理员点击“结束并重置”后，所有玩家立即恢复为 1000 分（包括离线、已下场和中途加入者），撤销未完成手牌，保留座位、口令和历史记录。自然结束后也可单独点击“重置积分”，无需等两人在线或再次开场。
- 自动轮换庄家、超时操作、连续超时暂离，支持中途加入和断线恢复。
- 牌局自动保存，支持记录查看、快捷聊天、语音提示和浏览器独立小窗口。

## 本地运行

安装 Node.js 22 或更新版本，在项目目录运行：

```sh
npm start
```

打开 [http://localhost:3000](http://localhost:3000)。首次启动时，终端会显示初始化密钥；在页面输入该密钥，设置管理员密码（至少 8 位）和访问口令（至少 4 位）。管理员勾选管理员身份登录，其他玩家使用访问口令。

同一浏览器的标签页共用身份，多人测试请使用不同浏览器或独立配置。刷新页面会恢复座位；换浏览器时，可在原连接离线后用原名字和当前口令恢复。中途加入的玩家从下一手参与。

运行测试：

```sh
npm test
```

## 部署

项目提供 [systemd 服务示例](deploy/friends-holdem.service) 和 [Nginx 配置示例](deploy/nginx.conf)。Linux 上将代码放入 `/opt/friends-holdem`，创建 `holdem` 系统用户，核对服务中的 Node 路径，再安装并启动服务：

```sh
sudo useradd --system --home /opt/friends-holdem --shell /usr/sbin/nologin holdem
sudo cp deploy/friends-holdem.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now friends-holdem
sudo journalctl -u friends-holdem -n 30 --no-pager
```

将 Nginx 示例域名替换为自己的域名并配置 HTTPS。服务示例仅监听回环地址，使用安全 Cookie，并信任本机 Nginx 提供的真实客户端 IP。通过日志获取首次初始化密钥后，在 HTTPS 页面完成设置。

常用环境变量：

| 变量 | 说明 |
| --- | --- |
| `HOST` / `PORT` | 监听地址和端口，默认 `0.0.0.0:3000` |
| `DATA_DIR` | 状态目录，默认项目下的 `data/` |
| `SECURE_COOKIE` | HTTPS 部署设为 `1` |
| `TRUST_PROXY` | 使用本机 Nginx 反向代理时设为 `1` |
| `SETUP_KEY` | 可选初始化密钥，默认启动时随机生成 |

仅支持单实例运行，不要启动多个 worker 共用同一状态文件。

## 数据与隐私

`data/state.json` 保存密码摘要、玩家信息、牌局和会话凭证。部署示例将其放在 `/var/lib/friends-holdem/`。这些数据只应由服务管理员访问，备份也应妥善保管。

运行数据、日志、环境变量文件、密钥、截图和本地打包文件已加入 `.gitignore`。请勿提交真实口令、初始化密钥、会话 Cookie 或部署凭证；公网使用 HTTPS，并仅通过 Nginx 暴露服务。
