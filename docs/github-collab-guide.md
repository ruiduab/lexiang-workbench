# GitHub 协作手册（零基础版）

本手册写给从未用过 GitHub 的同事，跟着做就能参与 `lexiang-workbench` 项目协作。

整个流程一次性大约 15 分钟。完成后，你就能在自己电脑上修改代码、提交给 baiyu 审核合并。

---

## 第一部分：注册 GitHub 账号（5 分钟）

### 1. 打开注册页

浏览器访问 https://github.com/signup

### 2. 填写信息

- **Email**：用工作邮箱
- **Password**：8 位以上，包含数字
- **Username**：用户名建议用拼音或英文，简单好记（**记下来，后面要发给 baiyu**）
- 验证拼图 → Continue

### 3. 验证邮箱

GitHub 会发一封带 8 位验证码的邮件，去邮箱复制粘贴回来。

### 4. 选择套餐

注册完成后会问你要 Free / Team / Enterprise，**选 Free**（免费够用）。

### 5. 跳过引导

- "How many team members will be working with you?" → 选 Just me
- "What do you want to do first?" → 随便选或 Skip personalization
- 看到 GitHub 主页（左上角有头像+用户名）就算成功了

### 6. 把用户名发给 baiyu

baiyu 会把你加入 `lexiang-workbench` 仓库的协作者名单。**没加入之前你看不到这个仓库**。

加入后你的邮箱会收到一封邀请邮件，**点邮件里的 "Accept invitation" 按钮**才算正式入伙。

---

## 第二部分：装工具（10 分钟）

要在自己电脑上改代码，需要装两个东西：

### 1. Git（命令行工具）

| 系统 | 下载链接 |
|---|---|
| **Windows** | https://git-scm.com/download/win （下载后一路 Next 即可） |
| **macOS** | 打开"终端"输入 `git --version`，会自动提示安装；或装 https://brew.sh/ 后跑 `brew install git` |

装完后打开"终端"（Windows 是 PowerShell 或 Git Bash，Mac 是 Terminal），输入：

```bash
git --version
```

能看到版本号（如 `git version 2.43.0`）就 OK。

### 2. VS Code（代码编辑器）

下载：https://code.visualstudio.com/

装完打开，左侧栏点扩展图标（四个方块），搜索安装：
- **Chinese (Simplified) Language Pack** — 中文界面
- **GitLens** — 看代码改动历史超好用

### 3. 配置 Git 身份（一次性）

打开终端，把下面命令的"你的名字"和"你的邮箱"换成自己的：

```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱@example.com"
```

邮箱必须和 GitHub 账号注册时用的邮箱**一致**，否则提交记录关联不上你。

---

## 第三部分：把代码下载到自己电脑（克隆）

### 1. 生成 GitHub 访问令牌（PAT）

GitHub 现在不能用密码 push 代码，必须用 **Personal Access Token (PAT)**。生成步骤：

1. 登录 GitHub → 右上角头像 → **Settings**
2. 左下角 **Developer settings**
3. **Personal access tokens** → **Fine-grained tokens**
4. 点 **Generate new token**
5. 配置：
   - **Token name**：`lexiang-workbench`（随便起）
   - **Expiration**：90 days
   - **Repository access**：选 **Only select repositories** → 选 `shuitian23-bot/lexiang-workbench`
   - **Repository permissions**：
     - **Contents**：Read and write
     - **Metadata**：Read-only（默认有）
     - **Pull requests**：Read and write
6. 拉到最底点 **Generate token**
7. **立刻复制 token**（`github_pat_...` 开头），保存到密码管理器或记事本。**这个 token 只会显示一次，关了页面再也看不到。**

> ⚠️ Token 等同于密码，别截图发群、别提交到代码里。

### 2. 克隆仓库到本地

打开终端，进入你想放代码的目录（比如桌面或 `Documents`）：

```bash
cd ~/Desktop      # Mac/Linux
# 或
cd Desktop         # Windows
```

然后克隆：

```bash
git clone https://github.com/shuitian23-bot/lexiang-workbench.git
```

第一次会让你输入：
- **Username**：你的 GitHub 用户名
- **Password**：粘贴**刚才生成的 PAT**（不是 GitHub 登录密码！）

下载完会得到一个 `lexiang-workbench/` 文件夹。

### 3. 装项目依赖

```bash
cd lexiang-workbench
npm install
```

等几分钟，依赖装好。

### 4. 用 VS Code 打开

```bash
code .
```

或者直接用 VS Code 菜单 → **File** → **Open Folder** → 选 `lexiang-workbench` 文件夹。

---

## 第四部分：日常协作工作流（核心）

记住这 6 个命令，覆盖 90% 场景：

```bash
git pull                       # ① 开工前：拉最新代码
git checkout -b 你的分支名       # ② 新建一个分支干活
# 改代码...
git add .                      # ③ 把改动加入暂存
git commit -m "改了什么"        # ④ 提交到本地
git push -u origin 你的分支名   # ⑤ 推到 GitHub
# 然后去 GitHub 网页提 PR（见下文）
```

### 完整示例：你要改 GEO 看板的标题

#### 第 1 步：拉最新代码

每次开工前**必做**，避免和别人冲突：

```bash
cd lexiang-workbench
git checkout main
git pull
```

#### 第 2 步：创建你自己的分支

**永远不要直接在 main 上改！** 创建一个属于你的分支：

```bash
git checkout -b feat/zhangsan-geo-title
```

分支命名建议格式：`feat/你的名字-改了啥` 或 `fix/你的名字-修了啥`

#### 第 3 步：用 VS Code 改代码

打开文件，改完按 `Ctrl+S` (Mac: `Cmd+S`) 保存。

#### 第 4 步：查看改了什么

```bash
git status        # 看哪些文件被改了
git diff          # 看具体改了什么
```

#### 第 5 步：提交改动

```bash
git add .                                  # 加入所有改动
git commit -m "feat(geo): 改了看板标题"     # 提交并写说明
```

提交说明（commit message）建议格式：
- `feat: 新功能` — 比如 `feat(geo): 新增转化漏斗`
- `fix: 修 bug` — 比如 `fix(dashboard): 修复总览数字错位`
- `docs: 改文档` — 比如 `docs: 补充 README`
- `style: 改样式` — 比如 `style: 调整按钮颜色`

#### 第 6 步：推到 GitHub

```bash
git push -u origin feat/zhangsan-geo-title
```

第一次推会让你输 GitHub 用户名 + PAT。

#### 第 7 步：去 GitHub 网页提 Pull Request (PR)

1. 浏览器打开 https://github.com/shuitian23-bot/lexiang-workbench
2. 你会看到一个黄色提示条 "Compare & pull request"，**点它**
3. 写 PR 标题和描述：
   - **标题**：和 commit message 类似，简洁说明改了什么
   - **描述**：写清楚为什么改、改了哪些地方、有什么注意事项
4. 点 **Create pull request**
5. **通知 baiyu** 来 review（微信/钉钉发个链接）

#### 第 8 步：baiyu 审核通过后，合并 PR

1. 打开你的 PR 页面，往下滚到底部
2. 确认显示绿色的 **"No conflicts with base branch"**（没有冲突）
3. 点绿色的 **Merge pull request** 按钮
4. 再点 **Confirm merge** 确认
5. 合并成功后，页面会显示 "Pull request successfully merged and closed"
6. 点 **Delete branch** 按钮删掉你的远程分支（清理用，不删也行但会越来越多）
7. 回到本地终端清理：
   ```bash
   git checkout main
   git pull
   git branch -d feat/zhangsan-geo-title   # 删本地分支
   ```

> 💡 合并后代码会自动部署到线上（https://leaibot.cn/admin/workbench.html），大约 10 秒内生效。

---

## 第五部分：常见问题排坑

### Q1: `git pull` 提示 "Your local changes would be overwritten"

意思：你本地改了东西还没提交，pull 会冲掉。

解决：
```bash
git stash         # 把本地改动暂存起来
git pull          # 拉最新
git stash pop     # 把刚才的改动恢复回来
```

### Q2: `git push` 报 "rejected, non-fast-forward"

意思：远程有别人新提交的代码，你本地落后了。

解决：
```bash
git pull --rebase
git push
```

### Q3: 改了文件忘了切分支，直接在 main 上改了怎么办？

```bash
git stash                              # 暂存改动
git checkout -b feat/我的分支          # 切到新分支
git stash pop                          # 把改动恢复到新分支
```

### Q4: 提交了不想要的内容怎么办？

如果**还没 push**：
```bash
git reset --soft HEAD^   # 撤回最后一次 commit，改动还在
```

如果**已经 push 了**：联系 baiyu，不要自己用 force push。

### Q5: 合并 PR 时有冲突怎么办？

不要慌。在 GitHub 网页上点 "Resolve conflicts"，根据提示选择保留哪段。看不懂就联系 baiyu。

### Q6: 怎么看别人改了什么？

```bash
git log --oneline -20      # 看最近 20 条提交
git log -p 文件名           # 看某个文件的所有改动历史
```

或者用 VS Code 的 **GitLens** 插件，每行代码旁边会显示是谁什么时候改的。

---

## 第六部分：协作禁忌 ⚠️

1. ❌ **永远不要直接 push 到 main 分支** — 必须走 PR 流程
2. ❌ **永远不要 `git push --force`** — 会覆盖别人的提交
3. ❌ **永远不要把 PAT、密码、`.env` 文件提交到仓库** — 上传后即使删除也已经被记录，必须重新生成
4. ❌ **不要提交 `node_modules/`、`*.db`、大文件** — `.gitignore` 已经配置好，正常 `git add .` 不会带这些，但别手贱用 `-f` 强加
5. ❌ **不要在不和 baiyu 沟通的情况下 merge 别人的 PR**
6. ✅ **每次开工前先 `git pull`**
7. ✅ **每个任务一个分支，分支用完即删**
8. ✅ **commit message 写人话**，别用 "update"、"fix bug"、"."

---

## 第七部分：求助

- 卡住了直接问 baiyu，别死磕
- 不确定的命令**先 Google 或问 ChatGPT** 再敲，尤其是带 `--force`、`reset`、`rm` 的
- 仓库地址：https://github.com/shuitian23-bot/lexiang-workbench
- 项目本地路径（baiyu 服务器）：`/root/lexiang`
- 部署后访问：https://leaibot.cn/admin/workbench.html

---

**最后**：第一次操作可能会紧张，建议先在自己分支上随便改个不重要的文件（比如这个文档加一行你的名字），走一遍完整流程：分支 → commit → push → PR → merge → 删分支。跑通一次心里就有数了。
