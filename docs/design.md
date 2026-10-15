# 八班风云 · 设计说明（合并版）

> 这份文档由原来 docs/ 下的多份说明合并而成，方便一次看完。
> 游戏本体就是根目录的 index.html（单文件，双击即玩）；改代码后跑 `node tools/build.js` 重新打包。



---

# game-design

### 《八班风云》玩法流程与公共卡池设计

> v1 ｜ 主策划文档 ｜ 配套：`docs/design-summary.md`（主程速读）、`data/common.json`（公共牌数据）、`docs/effects-dsl.md`（效果契约）

### 一、一句话定位

八班课间十分钟的江湖。两名同学用"绝活卡"互相卷成绩：**先到 20 分你赢，先掉到 0 分你输。** 全场只有嘴炮和梗，没有任何写实伤害。

### 二、核心数值

| 项目 | 数值 | 说明 |
| --- | --- | --- |
| 成绩 `score` | 开局 10 / 上限 20 | 先到 20 立即胜；降到 0 立即败 |
| 精力 `energy` | 上限 3，每回合回满 | 打牌费用，不累积 |
| 气势 `momentum` | 上限 5，每回合 +1 | 大招专用 |
| 手牌 | 开局 4，上限 8 | 超出立即弃掉 |
| 牌堆 | 每人 30 张 = 12 公共 + 18 专属 | 抽完把弃牌堆洗回去 |

成绩能涨也能掉，所以存在两种赢法：**卷上去**与**把对方打下去**，两者都要成立。

### 三、对局形式

1v1。默认**玩家 vs 电脑 AI**，也可切换**同机双人轮流操作**（同一套流程，只是换人点"我出牌"）。双方各开局抽 4 张；后手方额外获得 1 层【状态不错】作为补偿。

### 四、回合流程（严格按此顺序实现）

每回合固定 7 步，**不采用"先补牌、再打牌、最后清算"的老三段式**，改叫上课铃与下课铃：

1. **上课铃响** —— 回合开始。
2. **收拾桌面** —— 每层【心态崩】弃 1 张手牌（不足则全弃）。
3. **老师发卷** —— 抽 2 张；每层【赶作业】再 +1。超过 8 张立即弃掉。
4. **精神回满** —— 精力重置为上限 3。
5. **起势** —— 气势 +1（上限 5）。
6. **课间十分钟** —— 自由出牌，见第五节。
7. **下课铃响** —— 依次结算：每层【臭气】对手 -1 成绩 → 每层【状态不错】自己 +1 → 每层【干儿子】自己 +1 → 清零【面子上过得去】→ 查胜负。

**先手补偿**：先手方第 1 回合的第 3 步只抽 **1** 张，之后都抽 2 张。

**胜负检查**：第 7 步后立刻查；此外每次成绩变化后立刻查，满足即终止对局。同一时刻双方都达标时按"当前回合玩家优先"。

### 五、自由出牌规则

- 按任意顺序出任意张手牌，只要付得起费用；没有"每回合只能出一张攻击牌"之说。
- 单张结算固定为：**查费用 → 扣精力/扣气势 → 执行 `ops` → 查胜负**，不足的牌灰掉，精力不会为负。
- 每出一张牌都累加本回合出牌数（引擎内 `cardsPlayedThisTurn`，回合开始归零），供连招与统计使用。
- 第 3 步超上限才弃牌，回合收尾**不**额外弃牌。
- 每结算一张牌就查一次胜负，避免"打出 3 点伤害却还被翻盘"的时序歧义。

### 六、三个附加机制

1. **课后作业（持续状态）**：用 `applyStatus` + `duration` 实现，代表"明天还要交"，在固定时点给持有者收益或损失（如【值日表】【广播体操】）。不新增状态键，全部复用契约状态表。
2. **点名（打断）**：即 `silence`【被点名】。持有者下一张牌的效果不生效（仍消耗精力与手牌），随后消费 1 层。【班主任的凝视】是公共池唯一的打断牌。
3. **围观群众（场面标记）**：用 `flags` 或 `hype`【声援】表示"多少人看你"，每层让该玩家造成的伤害 +1；它属于**攻击方**，随出牌者切换归属，需挂在玩家对象上。

### 七、公共卡池设计原则

- **便宜、朴实、通用**：精力 0~2，单体伤害 1~2 点，**不含任何大招**（`momentum` 全 0，`type` 不含 `ult`）。
- 12 张里 4 `attack` / 4 `tactic` / 4 `support`，其中 **4 张纯功能牌**（抄作业、保温杯、课间十分钟、球场占位）。
- `ops` 只用契约里的 25 个原子操作与 10 种条件表达式，**零新 op**。
- 卡名走校园日常梗，覆盖课堂、操场、食堂、办公室、作业五个场景。
- `data/common.json` 恰好 12 个不同 id，`count` 之和 = 12。因为 12 张不同 id 正好摊满 12 个牌位，**每张 `count` 必然是 1**；专属牌由另一位同学补 18 张，两者相加即 30 张牌堆。

### 八、平衡基准

- **1 精力 ≈ 1 点成绩**是公共牌基准汇率（1 费打 1，2 费打 2，带条件的牌满足条件时白赚 1 点）。
- 从 10 分打到 0 分需净 10 点输出；按每回合约 2 点有效输出算，一局约 **8~12 回合**，正好是"课间十分钟"的体感长度。
- 公共池只有【保温杯】能回 1 点血，防止对局无限拉长。
- 大招不进公共池，气势资源完全服务于角色专属牌，避免公共池抢角色戏份。

### 九、给主程的实现备注

1. 读表只认 `data/common.json`，字段名不要改；`art` 是占位路径，缺图降级成文字卡面，不要抛错。
2. 本池只有一个标记 `zuoyeUsed`（【抄作业】）：首次出它抽 1 张，之后每次出都复制上一张牌。实现就是 `addFlag` + `flagAtLeast`，别新增引擎没有的操作，也别依赖全局字段。
3. 【抄作业】的 `copyLastCard` 复制的是"上一条进入弃牌堆、且不是它自己"的牌，跨回合仍成立，卡面文案已按此措辞。
4. 第 7 步结算方向严格照写：【臭气】打对手、【状态不错】加自己，写反数值就崩。
5. 校验脚本：`node data/validate-common.js`（JSON 可解析、12 张卡、`count` 之和 = 12、op 白名单、禁用词与合规红线），改牌池后必跑。

### 十、与角色专属牌的接口

- 【自习课】读取"对手【干儿子】≥2 层"。该状态本池不产出，属任乐专属牌的召唤物；没遇到任乐时它就是一张朴实的 1 费 1 点牌，不会失效。
- 【班主任的凝视】是公共池唯一的打断牌，与【临时抱佛脚】同为 `rare`（后者负责追击领先的对手）。
- 专属牌若要"生成一张公共牌"，直接按 id 引用即可，本池 id 固定为 `common_01` ~ `common_12`。



---

# modes-design

### 《八班风云》三模式设计：教程关 / 剧情模式 / 无尽模式

配套数据：`modes.json`（模式与教程脚本）、`story.json`（剧情文本）。本文只写"要什么、接口长什么样、不传时行为不变"。

### A. 三个模式的定义与入口

开始界面顶部加一排模式卡片，顺序固定，右侧显示解锁状态：

| 顺序 | 模式 | 按钮文案 | 副标题 | 解锁 |
| --- | --- | --- | --- | --- |
| 1 | tutorial | 新手教程 | 三分钟学会出牌 | 始终解锁 |
| 2 | story | 剧情模式 | 三段课间故事 | 始终解锁 |
| 3 | endless | 无尽模式 | 连胜越多对手越凶 | 始终解锁 |

- **教程**固定张凯尧（你）vs 于浩天（陪练），不选人。
- **剧情**主角是"你"这个新同学：`story.json` 没有 player 字段，第 1 关的对手又是张凯尧，所以先选一次人并存进 `baban_story_player`；撞人时允许镜像对决（引擎不限制，"不能自己打自己"只是选人页的 UI 校验）。
- **无尽**沿用现在的选人页。

**教程第一次必须走吗？推荐"自动引导 + 随时跳过"**：没写过 `baban_tutorial_done` 时教程卡片置顶高亮，「上课铃响」默认进教程；教程条常驻「跳过」，跳过即写 `baban_tutorial_done=skipped`，之后不再自动引导，卡片仍能点进去重学。理由：成绩双向、气势、状态结算不教一遍，新手第一局必输；硬锁入口又劝退老玩家。

注意：第 3 关 reward 写的"解锁：自选对决（无尽模式）"与"无尽始终解锁"冲突，建议改成"解锁强化对手档位 + 剧情回看"。

### B. 教程关分步脚本（13 步）

| 步骤 | 教什么 | 屏幕上说什么 | 前置状态怎么摆 | 过关条件（可判定） | 高亮 |
| --- | --- | --- | --- | --- | --- |
| t1 | 认识成绩条 | 满 20 赢，掉 0 输 | 双方 10 分，精力 3，手牌 1 张 | 点一下自己的成绩条（`tap`） | #my-score-bar |
| t2 | 出一张打击牌 | 点手牌就能出牌 | 对手 10 分，手牌【食堂冲刺】 | 打出 common_07（`playCard`） | #hand |
| t3 | 精力用尽 | 精力花光，牌就变灰 | 精力 1，手牌 1 费 / 3 费各一张 | 打出 zhangkaiyao_02，另一张变灰 | #my-energy |
| t4 | 结束回合 | 不想出牌就铃响收尾 | 精力 3，给一张能出的【保温杯】 | 点铃响收尾（`endTurn`） | #btn-end |
| t5 | 抽牌 | 抽牌才有得选 | 手牌【课间十分钟】0 费抽 2 | 打出 common_05 | #hand |
| t6 | 用一张助攻 / 防御牌 | 助攻牌回成绩、加【面子】 | 自己 8 分，手牌【人墙防守】 | 打出 zhangkaiyao_08，生出【面子】 | #my-status |
| t7 | 攒气势 | 气势每回合 +1 | 气势 1，手牌【替补席热身】 | 打出 zhangkaiyao_09，气势到 2 | #my-momentum |
| t8 | 攒气势放大招 | 气势 3 点放大招，一局一次 | 气势 3，手牌大招【帽子戏法】 | 打出 `type=ult` 的牌 | #hand |
| t9 | 认识状态 | 状态会留好几个回合 | 精力 3，手牌【广播体操】 | 打出 common_09，拿 2 层【状态不错】 | #my-status |
| t10 | 状态在回合结束结算 | 铃响之后状态才结算 | 我 12 分带【状态不错】2 层，对手 8 分带【臭气】2 层 | 点铃响收尾，看分数跳动 | #btn-end |
| t11 | 学会看对手手牌数 | 数手牌就知道他剩多少弹药 | 对手手牌 6 张（上限 8） | 打出 zhangkaiyao_11 亮牌 | #foe-side |
| t12 | 收尾一击 | 对手只剩 4 分，一脚踹下去 | 对手 4 分，手牌【食堂冲刺】 | 对手成绩低于 3（`scoreBelow`） | #foe-score-bar |
| t13 | 通关 | 出牌、精力、气势、大招都会了 | 任意 | 点「完成教程」（`next`） | #my-score-bar |

### 为了教学，允许对引擎做的最小改动（6 条，不启用即完全等于现在）

1. **开局覆盖 `opts.setup`**（`engine.js` 已实现）：`setup[0]/setup[1] = { score, energy, momentum, hand: [id…], deckOrder: [id…], deckCards: [id…] }`。教程数据里的 `myScore/foeScore/myEnergy/myMomentum/myHand` 由模式层翻译成 `setup[0]/setup[1]`；不传 `setup` = 原来的随机开局。
2. **固定手牌与牌序**：`hand` 里给 id 数组 = 指定手牌（优先从牌堆拿，牌堆没有就按 id 直接造，`_findCard`，教程能"凭空发牌"），给数字 = 只发 N 张、内容照常洗（教程 `foeHand: 2` 用这个形式）；`deckOrder` 把命中的牌倒序压到牌堆顶；`deckCards` 直接把整副牌堆换成给定 id 清单（剧情 `enemyDeck` 用它，同一个 id 两次就是两张）。不传 = 现在的洗牌。
3. **对手放水 `setup.aiHandicap = { maxCardsPerTurn, thinkMs }`**（已实现）：`BabanAI.takeTurn` 出满 N 张即停，教程固定 `{ maxCardsPerTurn: 1 }`；陪练不该把新手打死，也不该每回合打空手牌。不传 = 现行难度表。
4. **固定开局状态 `setup[i].status`**（建议补）：t10 要演示"带 2 层【状态不错】、对手 2 层【臭气】时铃响怎么结算"，就得能预置状态（`p.status` 整体覆盖）。不传 = 无开局状态。
5. **关掉被动 `setup.passive: false`**（建议补）：于浩天【寸头反光】每回合给玩家叠【尴尬】，会把教学伤害悄悄 -1。在 `takeTurn` 第 6 步与 `fireTriggers` 开头各加一行 `return`；不传 = 被动照常。
6. **步骤控制器**（`src/tutorial.js` 已实现，引擎零改动）：监听 `actionWindow`（轮到玩家时套用 `setup`）、`play`（事件已带 `player`/`cardId`/`cardType`，判 `playCard`）、`turnEnd`（只认玩家一方，判 `endTurn`）、`statusTick`/`statusExpired`（讲状态结算），分数一变就读 `players[i].score` 判 `scoreBelow`；`tap`/`next` 由提示层在 `highlight` 元素和「下一步」按钮上挂监听。另需 `#foe-hand-count` 角标（`view.render` 写 `foe.hand.length`），否则"看手牌数"没东西可看。**只读事件，不写引擎。**

> **与代码对齐**：`modes.json` 是数据源（`embedded-data.js` 已内联），但 `src/tutorial.js` 里另有一份硬编码的 `TUTORIAL_STEPS`（字段是 `setup[0]/[1]` + `advance`），合并前实际跑的是后者；建议以 `modes.json.steps` 为唯一数据源，加一层 `myScore→setup[0].score`、`completeOn→advance` 的翻译。

### C. 剧情模式的关卡推进（已按 data/story.json 对齐）

现成数据是 3 关 6 场（1 / 2 / 3 场）。

- **多场怎么串**：进关先播 `intro`（逐行对白）→ 每场先给 `taunt` → 赢了播 `winLine` 立刻进下一场 → 最后一场赢再播 `outro` + `reward.text`。输了播 `loseLine` 并**重试本场**，不重开本关；同一场连输 2 次，重试按钮旁给 `hint`，并把难度临时降一档。
- **每场怎么转成 `opts.setup`**：`playerScore`/`enemyScore` → `setup[0]/setup[1].score`，`enemyOpeningHand` → 对手发几张，`enemyDeck` → `setup[1].deckCards`（可重复 id；空数组 = 默认 30 张牌堆）。`teach` 挂界面顶部，赢了在结算里打勾；`title`/`taunt` 打在对手头像旁。
- **进度存哪**：`localStorage["baban_story_progress"]`：
  ```json
  { "version": 1, "lastStage": "stage2",
    "stages": { "stage2": { "cleared": false, "encounter": 1, "attempts": 2, "clearedAt": 0 } } }
  ```
  `encounter` = 已通过场次数，重进本关从它继续，打完的场不重打；选中的主角另存 `baban_story_player`。
- **结算界面显示**：`winLine`/`loseLine` + 关底 `outro` + `reward.text` + `teach` 打勾 + 三个按钮「下一关 / 重打本关 / 回大地图」。
- **怎么回大地图**：把关卡渲染成 `#stage-map`，每关一张卡片（编号、标题、副标题、目标、通关章）；已通关的可重玩，只加 `attempts`，不清 `cleared`。

### D. 无尽模式

现在这套"随便挑两个人对打"只改名不够，加四件（全部用现有旋钮）：

1. **连胜计数**：赢一场 `baban_endless_streak` +1，输了归零并写 `baban_endless_best = max(best, streak)`；选人页顶部显示「当前连胜 N · 历史最高 M」。
2. **难度递增曲线**：开局按连胜数取命中的最高档。

| 连胜 | 档位 | aiThreshold | 对手起始分 | 额外抽牌 | 起始气势 |
| --- | --- | --- | --- | --- | --- |
| 0 | 热身 | 1.1 | 10 | 0 | 0 |
| 2 | 开始来劲 | 0.8 | 11 | 0 | 0 |
| 4 | 有点意思 | 0.55 | 12 | 0 | 1 |
| 6 | 年级前十 | 0.35 | 13 | 1 | 1 |
| 8 | 教导主任 | 0.15 | 14 | 1 | 2 |
| 10 | 八班传说 | 0 | 15 | 2 | 2 |

四个旋钮的接法：`aiThreshold` → `new BabanAI({ threshold })`；`foeBonusScore` → `setup[1].score = 10 + n`；`foeExtraDraw` → `setup.extraDraw`（建议补：`takeTurn` 抽牌数 +n）；`foeStartMomentum` → `setup[1].momentum`。阈值 1.1→0 让 AI 从"只出划算的牌"变成"有牌就出"；对手起始分 10→15 等于把输出要求从 10 拉到 15；4 胜后叠加抽牌与气势，难度继续涨而不用动卡池。

3. **每 3 胜遇到强化对手**：`wins > 0 && wins % 3 === 0` 时取下一档，再叠 `bossBonus`（对手额外抽 1 张 + 开局 1 层【声援】），标题加「强化对手 · 」。
4. **失败后记录最高连胜**：结算显示「本次连胜 N / 历史最高 M / 当前档位」，两个按钮「再来一局（档位不降）」与「回开始页（连胜清零）」。

### E. 三个模式共享什么、各自独有什么

| 类别 | 共享 | 独有 |
| --- | --- | --- |
| 卡池 | `common.json` + 四个角色专属池 | 教程 `deckOrder`；剧情 `enemyDeck` |
| 规则 | `engine.js` 全流程、效果 DSL、成绩条胜负判定 | 教程 `setup` 冻结 + `aiHandicap`；剧情每场 `setup`；无尽难度曲线 |
| UI | 对战界面 `view.js`、卡面 `buildCardElement`、卡池图鉴、结算弹窗、音效 | 教程台词条 + 高亮环；剧情对话框 + 关卡地图；无尽连胜条 + 档位标签 |



---

# ui-design

### 《八班风云》UI 与动效设计说明 v1

> 令牌 `data/ui-tokens.json`；动效 `data/animations.json`（24 条）。只做设计约定，不写实现代码。

### 1. 视觉概念与情绪板

**一句话**：把教室后墙的黑板报搬进网页——深墨绿黑板当底、粉笔白当字；卡牌是错题本上的纸片，提示是便利贴，成绩是值日表上的红笔记录，角色靠球衣号码认人。

关键词：课间十分钟、黑板报、粉笔灰、便利贴、错题本、值日表、球衣号码、课桌刻痕、球场草皮、创可贴。

情绪与质感：热闹但干净，青春、手作、有梗；夸张靠形变与留白，不靠脏乱。氛围只取**抽象质感**，不抄具体作品。所有"受伤"都是舞台效果，只显示成绩涨跌，守住 `characters-brief.md` 合规红线。材质纯用 CSS：黑板底叠 `repeating-linear-gradient` 做粉笔灰，纸片面板用纸白底 + 冷灰格线 + 外投影。

### 2. 布局分区图

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [1] 顶部 · 对手区                                                        │
│   于浩天 [球衣4]   成绩 ████████░░░░ 14/20   精力 ●●●   气势 ■■□□□       │
│   状态 [臭气2][尴尬1]   牌堆12   弃牌5                                   │
├──────────────────────┬────────────────────────────┬──────────────────────┤
│ [2] 对手立绘         │ [3] 战场 / 日志            │ [4] 玩家立绘         │
│ 160x160              │ 出牌槽 [ ][ ][ ]           │ 160x160              │
│ 成绩条 22px          │ ────────────────────       │ 成绩条 22px          │
│ 气势条 + 精力球      │ 飞卡落点/粉笔灰拖尾        │ 气势条 + 精力球      │
│ 状态图标行           │ 大招全屏层                 │ 状态图标行           │
│                      │ ────────────────────       │                      │
│                      │ 日志（错题本纸卷）         │                      │
│                      │ > 对手打出「菠萝」         │                      │
├──────────────────────────────────────────────────────────────────────────┤
│ [5] 回合横幅：上课铃 / 下课铃（居中全屏覆盖层）                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [6] 底部 · 手牌区（课桌桌面）                                            │
│  牌堆12  [1][2][3][4][5][6][7][8] 148x208  精力●●●  气势■■■□□  [结束回合]│
│          ↑ 数字键 1-8 选牌 · 空格结束回合                                │
└──────────────────────────────────────────────────────────────────────────┘
```

- **[2] / [4] 立绘**是受击与治疗的动画锚点；**[6] 手牌区**牌堆在左、1-8 号牌居中。

**实现映射**：`index.html` 已按此分区竖排为"对手条 / 战场+日志 / 玩家条 / 手牌区"，元素与编号一一对应。

### 3. 配色表

| 令牌 | 色值 | 用途 | 对 bg 对比度 |
| --- | --- | --- | --- |
| bg | #22362F | 黑板底 | — |
| bgAlt | #2F4A43 | 次级底 | — |
| panel | #FBF7EC | 面板、卡面 | 11.99 |
| panelLine | #9FB6CF | 纸面格线 | 对 panel 1.95 |
| ink | #23324F | 纸面正文 | 对 panel 11.96 |
| inkDim | #4A5C7A | 次要文字 | 对 panel 6.32 |
| chalk | #EAF2F8 | 黑板正文 | 11.34 |
| accent | #5BAAE0 | 主按钮、链接 | 5.05 |
| accentAlt | #F0913F | 次强调、大招框 | 5.39 |
| danger | #E4574C | 扣分、危险 | 3.52 |
| success | #3FA45B | 加分、通过 | 4.08 |
| warning | #F7C948 | 警告、气势 | 8.19 |
| char1 张凯尧 | #3FA45B | 国安绿/草皮 | 4.08 |
| char2 刘梓嘉 | #F07FA8 | 创可贴粉 | 5.07 |
| char3 任乐 | #7A5AD1 | 峡谷紫金 | 2.57 |
| char4 于浩天 | #F7C948 | 菠萝黄/寸头灰 | 8.19 |

**对比度**：正文只用 ink / inkDim（纸面）与 chalk / chalkDust（黑板），最低 6.32:1，全部达标。语义色与角色色只作填充与图标，其上的字改用 panel 或 ink。

### 4. 字体与字号阶梯

系统字体栈，零外链。**display**（横幅、标题，板书手写感）：`"Segoe Print", "Chalkboard SE", "Kaiti SC", KaiTi, STKaiti, "PingFang SC", "Microsoft YaHei", sans-serif`。**body**（正文、日志）：`system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`。**mono**（数字、计数）：`ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace`。

| xs 12px | sm 14px | md 16px | lg 20px | xl 28px | xxl 40px |
| --- | --- | --- | --- | --- | --- |
| 标签 | 卡牌描述、日志 | 正文、按钮 | 卡牌名、角色名 | 成绩数字 | 回合横幅 |

行高 1.5 / 1.5 / 1.6 / 1.35 / 1.1 / 1.05；标题字距 0.06em（仿粉笔字空隙），正文为 0。

### 5. 组件清单

1. **卡牌正面**：148×208，14px 圆角；顶部 8px 类型色条（attack=danger / tactic=accent / support=success / ult=warning）；左上精力消耗、右上气势需求；中部插画 92px；稀有度是右上"便利贴折角"。
2. **卡牌背面**：黑板绿底 + 粉笔问号 + 球衣 8 号班徽。
3. **成绩条**：22px 高，纸白槽 + 渐变填充，右端 mono 数字"14/20"，满 20 描金边。
4. **气势条**：5 个便利贴小格，逐格点亮，满格脉冲提示大招。
5. **精力球**：3 个粉笔圆圈，可用实心高亮，已用灰化下沉。
6. **状态图标**：24px 方章 + 各异图标，右下标层数，悬停出说明。
7. **按钮**：主按钮 accent 底 + ink 深字，次按钮透明底 + chalk 描边，禁用去饱和半透明，最小高 44px。
8. **回合横幅**：横贯全屏的"黑板擦抹过"条带，玩家回合绿边、对手回合红边。
9. **结算弹窗**：错题本纸张质感，含胜负徽章、双方成绩 xxl、关键回合回顾与行动按钮。
10. **角色选择**：4 张课桌卡片（窄屏 2×2），含球衣号码 1-4、立绘、外号、人设与"选他"按钮。

### 6. 交互动效清单

24 条，只用 `transform / opacity / filter / clip-path`，首末帧见 `data/animations.json`：

抽牌 `drawCard`、手牌悬停 `cardHoverLift`、出牌 `cardPlay`、飞向目标 `cardFlyToTarget`、成绩增加 `scoreBarGain`、成绩减少 `scoreBarLoss`、数字滚动 `scoreNumberRoll`、受伤抖动 `hurtShake`、治疗回弹 `healBounce`、状态弹出 `statusIconPop`、状态递减 `statusStackDecay`、气势点亮 `momentumGain`、气势满脉冲 `momentumFullPulse`、精力消耗 `energyOrbSpend`、精力回满 `energyRefill`、回合横幅 `turnBanner`、大招全屏 `ultFullscreen`、命中震屏 `screenShake`、胜利结算 `victorySettle`、失败结算 `defeatSettle`、手牌上限抖动 `handLimitShake`、资源不足拒绝 `cardRejectShake`、屏蔽无效化 `silenceNullify`、头像受击 `portraitHit`。

节奏：反馈 120~220ms，数值 420ms，横幅 900ms；同屏并行 ≤3 组，伤害按"卡飞→命中→滚动→状态"串行。

### 7. 可访问性

- **色弱友好**：角色用"号码 + 立绘 + 外号 + 颜色"四重编码；状态图标形状各异；加减分带 `+/-` 与箭头；danger 与 success 明度差 > 20%。
- **点击区域 ≥ 44px**：手牌 148×208 已满足；状态方章视觉 24px、热区外扩 44×44；精力球、铃铛、关闭按钮同样外扩。
- **键盘可用**：`1-8` 选牌出牌，`←/→` 移动焦点，`Enter` 确认，`Esc` 关弹窗，`空格` 结束回合，`U` 放大招；焦点环 3px chalk + 2px 偏移，顺序为对手区 → 战场 → 手牌 → 按钮。
- **动效降级**：`prefers-reduced-motion: reduce` 时位移与缩放压到 ≤ 120ms 或跳末帧，只留透明度。
- **读屏**：横幅、分数变化、日志新增走 `aria-live="polite"`；卡牌 `aria-label` 念出"名称 + 消耗 + 描述"。



---

# ui-v2-card-layout

﻿# 《八班风云》卡面 v2 与出牌演出设计说明

> 实现文件：`styles/card-v2.css`（类名前缀 `cv2-`，不改动 `cards.css` / `main.css`，删掉引入行即回退）。
> 动效数据：`data/animations-v2.json`（16 条）。令牌：`data/ui-tokens.json`。

### 1. 一句话概念

把卡牌从"贴在桌上的便利贴"改成**一块压了印子的硬卡纸牌匾**：做旧纸底、四角倒角插画、上沿压印名字条、左上角作业本格子当代价、右侧"气"字圆章、底部一排贴纸印记、右下小方章。出牌改成**拎起 → 抛弧线 → 砸落压扁 → 回弹 → 扬粉笔灰 → 旁边晃一下 → 留一会儿压痕**。

关键词：错题本硬卡纸、粉笔灰、课桌刻痕、贴纸印章、折角。冷峻、有颗粒、可深色，但守住校园题材红线：不血腥、不惊悚、不用超自然符号。

### 2. 卡面结构图

### 2.1 手牌尺寸 168 × 222（1% = 1.68 × 2.22px）

```
 (0,0)                                                     (168,0)
   ┌───────────────────────────────────────────────────────┐  ← 折角 .cv2-fold 20×20
   │ ▣▣▢  第 12% ── 名字条 .cv2-name  26px ────────────────┐│     右上角被翻起
   │ ↑5px  ┌───────────────────────────────────────────────┐│
   │ 代价  │  右上角被折角切掉 7px                          ││
   │ 章    │  第 3 区 · 插画 .cv2-art  108px（49%）         ││  .cv2-cost 绝对定位
   │ .cv2- │  四角 7px 倒角 clip-path，内阴影 22px           ││  左 5px / 上 5px
   │ cost  │  里面再压一层极淡粉笔灰 .cv2-art::after        ││  三格作业本格子
   │ 26×14 │                                                ││  格宽 7px
   │       └──────────────  (6, 176) ───────────────────────┘│  ← 「气」字圆章 26×26
   │  第 4 区 · 效果文本 .cv2-text  弹性 ≈40px（18%）        ││     右 6px / 上 88px
   │  12.5px / line-height 1.34 / 16.4px 一道格线           ││     圆章 = 气势，格子 = 精力
   │  ―――――――――――――――――――――――――――――――――――――――――――――――――――    │
   │  第 5 区 · 印记行 .cv2-imprints  ≥20px（9%）            ││
   │  (创可贴)(演技) 贴纸，交替 ±0.9deg 旋转                ││
   │                                   第 6 区 · 角标 ▣ 20×20│  ← .cv2-seal 右下 5px
   └───────────────────────────────────────────────────────┘
 (0,222)                                               (168,222)
```

### 2.2 图鉴尺寸 208 × 292（1% = 2.08 × 2.92px）

```
 (0,0)                                                         (208,0)
   ┌───────────────────────────────────────────────────────────┐ ← 折角 26×26
   │ ▣▣▢ 4px ┌─────────────────────────────────────────────────┐│
   │ 格宽    │  第 1 区 · 名字条   34px（12%）  19px 字         ││
   │ 9px     ├─────────────────────────────────────────────────┤│
   │ 代价章  │  第 3 区 · 插画     132px（45%）                  ││
   │ 208 内  │  四角 7px 倒角，内阴影 22px                       ││  「气」章 26×26
   │ 左 5px  │                                                  ││  右 6px / 上 108px
   │ 上 5px  └─────────────────────────────────────────────────┘│
   │  第 4 区 · 效果文本   弹性 ≈52px（18%）  14px / 1.38        │
   │  ――――――――――――――――――――――――――――――――――――――――――――――――――――――     │
   │  第 5 区 · 印记行  ≥22px（8%）                              │
   │                                        第 6 区 · 角标 ▣ 24×24│
   └───────────────────────────────────────────────────────────┘
 (0,292)                                                   (208,292)
```

**区块 / 尺寸 / 字号 / 颜色 token 对照**

| 区 | 类名 | 手牌 | 图鉴 | 字号 | 颜色 token |
| --- | --- | --- | --- | --- | --- |
| 名字条 | `.cv2-band` + `.cv2-name` | 30 + 26px（12%） | 34 + 30px（12%） | 16 / 19px，字距 .06em | 底 `--cv2-type` 压深，字 `--chalk`，名 `--cv2-ink` 混 `--cv2-scribe` |
| 代价章 | `.cv2-cost` | 3×7px 格 | 3×9px 格 | 10px（可选） | 底 `--paper`，框 `--cv2-ink` 55%，实心格 `--paper`→`#E4DAC4` |
| 插画区 | `.cv2-art` | 108px（49%） | 132px（45%） | — | 底 `--cv2-type` 混深，描边 `rgba(24,18,10,.66)` |
| 效果文本 | `.cv2-text` | 弹性 ≈40px | 弹性 ≈52px | 12.5 / 14px | 字 `--cv2-ink` 混 `--cv2-scribe`，格线 `rgba(35,50,79,.13)` |
| 印记行 | `.cv2-imprints` / `.cv2-imprint` | ≥20px（9%） | ≥22px（8%） | 10 / 11px | 底 `--cv2-type` 16%，框 46%，负向印记走 `--c-danger` |
| 角标 | `.cv2-seal` | 20×20px | 24×24px | 11 / 13px | 普通 `·`；稀有 `--blue`；史诗 `--purple`；大招 `--yellow` |
| 气势章 | `.cv2-momentum` | 26×26px | 26×26px | 12px | 环 `--yellow`，底 `rgba(24,18,10,.5)` |
| 折角 | `.cv2-fold` | 20×20px | 26×26px | — | 亮面 `--cv2-edge-hi` → 暗面 `--cv2-edge` |

### 3. 信息层级：玩家一眼看什么

1. **插画区**占 45%~49% 高度，是最强视觉锚点——回答"谁在干什么"。
2. **名字条**紧贴插画上沿，形成"插图 + 标题"的报头结构——回答"这招叫什么"。
3. **代价标记**固定在左上角卡框外，方块格子一眼看出"出不出得起"。
4. **效果文本**决定"要不要打"，读第三眼；格线底纹让它像写在作业本上，不抢戏。
5. **印记行**补关键词，通常配合悬停气泡看。
6. **角标与折角**最后才被注意，只做"这张牌不普通"的质感暗号。

不可出牌时，卡面去色压暗，中部盖一条 **-2.2deg 的红笔批注条**（取 `data-reason`），比旧版便利贴横条更像"老师批的"。

### 4. 代价标记：作业本格数（不用血液意象）

- **读法**：0 精力 = 三格全空（即"免费"信号）；1 / 2 / 3 = 从左往右点亮对应格数。实心格是"粉笔压过"的米白渐变 + 1.5px 墨线内框，空格只有 0.55 透明度细框。三格分别错开 -1.4 / +1.2 / -0.6deg。
- **可达性**：格子数对色弱同样可读（形状 + 数量双编码）。
- **气势怎么区分**：气势**不用格子**，用右侧边缘一枚圆形"气"字粉笔章（26×26，环 `--yellow`，转 -8deg），靠**形状**（方 / 圆）、**位置**（左上 / 右中）、**颜色**（纸白墨线 / 金黄）三重区分。大招卡两枚标记一左一右。

### 5. 卡面材质：纯 CSS 做法

全部零位图，只靠渐变与阴影叠出来：

| 效果 | 手法 |
| --- | --- |
| 做旧纸底 | `linear-gradient(166deg, surface, surface-deep)` 打底，叠两层 `repeating-linear-gradient`（58deg / -32deg）当纸纤维 |
| 颗粒 | `repeating-conic-gradient(from 12deg at 50% 50%, var(--cv2-grain) 0% 25%, transparent 0% 50%)` + `background-size: 3px 3px` |
| 四角發暗 / 霉斑 | 三枚 `radial-gradient(…, rgba(24,18,10,.2), transparent 70%)`，整层挂 `.cv2-card::after` 并 `mix-blend-mode: multiply` |
| 课桌刻痕 | `::after` 上两条 0.5px 宽的 `linear-gradient(74deg / -58deg)` 斜线 |
| 内阴影 / 压印 | `inset 0 0 0 1px edge` + `inset 0 0 0 2px edge-hi` + `inset 0 0 34px rgba(24,18,10,.42)` + `inset 0 1px 0 rgba(255,253,246,.34)` |
| 折角 | `.cv2-fold`：`clip-path: polygon(100% 0, 0 0, 100% 100%)` + 斜向渐变 + `filter: drop-shadow(-1.5px 1.5px 1.5px rgba(0,0,0,.55))`，`::after` 再补一道折痕 |
| 插画嵌框 | `.cv2-art` 用 `clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), …)` 切四角 + `inset 0 0 22px rgba(0,0,0,.5)` |
| 贴纸印记 | 类型色 16% 底 + 46% 内描边 + 交替 ±0.9deg `rotate()` |
| 粉笔灰 | `radial-gradient(Npx Npx at x% y%, rgba(255,253,246,.85) 50%, transparent 51%)`，一枚一个点，成组用 |

### 6. 出牌演出分镜（重点）

从"手指点下"到"落位完成"共 7 帧，总时长 ≤ 760ms。

| 帧 | 时间 | 状态类 | transform / opacity / filter | 缓动 |
| --- | --- | --- | --- | --- |
| ① 手牌抬起 | 0–200ms | `.cv2-play-enter` | `translateY(0) scale(1)` → `translateY(-34px) scale(1.06)`；`filter: brightness(1)` → `brightness(1.08)` | `--ease-out`（140ms 版给鼠标悬停） |
| ② 飞向战场（弧线） | 180–540ms | `.cv2-play-fly` | 0% `translate3d(0,-34px,0) scale(1.06)` → 26% `translate3d(26px,-118px,0) rotate(8deg) scale(1.2)` → 66% `translate3d(-14px,-50px,0) rotate(-3.2deg) rotateY(14deg) scale(1.13)` → 100% `translate3d(0,6px,0) rotateY(0) scale(1.04)`，opacity 1 → .92 | `cubic-bezier(.2,.9,.2,1)`（380ms） |
| ③ 砸落（压缩形变） | 540ms 起 | `.cv2-play-slam` | 0% `translateY(-52px) scaleX(1.1) scaleY(1.16)` → **30% `translateY(0) scaleX(1.17) scaleY(0.82) rotate(.6deg)`**，`filter: brightness(1.2) contrast(1.08)` | 同段 300ms |
| ④ 回弹 ×3 | 660–840ms | 同上 | 52% `translateY(-9px) scaleX(.965) scaleY(1.07)` → 72% `translateY(0) scaleX(1.045) scaleY(.972)` → 86% `translateY(-2.5px) scaleX(.992) scaleY(1.012)` → 100% 归位 | 幅度逐次减半 |
| ⑤ 尘屑迸发 | 540–1440ms | `.cv2-dust`（+`::before` 细灰） | `scale(.42,.5) opacity 0` → 18% `scale(1.02,1.18) opacity .95` → 46% `scale(1.3,.9) opacity .6` → 100% `scale(1.46,.62) opacity 0` | `--ease-out`（900ms；细灰 1200ms，延迟 100ms） |
| ⑥ 落位微震 | 700–1420ms | 战场容器 `.cv2-rumble`（+ `.cv2-impact` 120ms 压暗） | `translate3d(0,4px,0) rotate(.14deg)` → `translate3d(0,-2.5px,0) rotate(-.1deg)` → 归零 | `cubic-bezier(.2,.9,.2,1)`（720ms） |
| ⑦ 压痕残留 | 540–2940ms | 槽位 `.cv2-residue` | `scale(.6,.42) opacity 0` → 6% `scale(1,1) opacity .92` → 26% `.62` → 72% `.42` → 100% `scale(1.07,.88) opacity 0` | `--ease-soft`（2400ms） |

**关键 `@keyframes`（与 `styles/card-v2.css` 一致）**

```css
@keyframes cv2-lift {
  0%   { transform: translateY(0) scale(1) rotate(var(--fan, 0deg)); filter: brightness(1); }
  100% { transform: translateY(-34px) scale(1.06) rotate(0deg); filter: brightness(1.08); }
}
@keyframes cv2-flight {
  0%   { transform: translate3d(0,-34px,0) rotate(0deg) scale(1.06);
         filter: drop-shadow(0 16px 22px rgba(0,0,0,.3)); }
  26%  { transform: translate3d(26px, var(--cv2-flight-y,-118px), 0)
                    rotate(calc(var(--cv2-flight-rot,-8deg) * -1)) scale(var(--cv2-flight-scale,1.2)); }
  66%  { transform: translate3d(-14px, calc(var(--cv2-flight-y,-118px) * .42), 0)
                    rotate(calc(var(--cv2-flight-rot,-8deg) * .4)) rotateY(14deg) scale(1.13); opacity: .98; }
  100% { transform: translate3d(0,6px,0) rotate(0deg) rotateY(0deg) scale(1.04); opacity: .92;
         filter: drop-shadow(0 6px 8px rgba(0,0,0,.42)); }
}
@keyframes cv2-slam {
  0%   { transform: translateY(-52px) scaleX(1.1) scaleY(1.16) rotate(-2.4deg);
         opacity: .94; filter: brightness(1.06); }
  30%  { transform: translateY(0) scaleX(1.17) scaleY(.82) rotate(.6deg);
         opacity: 1; filter: brightness(1.2) contrast(1.08); }
  52%  { transform: translateY(-9px) scaleX(.965) scaleY(1.07) rotate(-.5deg); }
  72%  { transform: translateY(0) scaleX(1.045) scaleY(.972) rotate(.2deg); }
  86%  { transform: translateY(-2.5px) scaleX(.992) scaleY(1.012) rotate(0deg); }
  100% { transform: translateY(0) scale(1) rotate(0deg); opacity: 1; filter: brightness(1); }
}
@keyframes cv2-dust-burst {
  0%   { opacity: 0;   transform: scale(.42,.5) translateY(6px); }
  18%  { opacity: .95; transform: scale(1.02,1.18) translateY(0); }
  46%  { opacity: .6;  transform: scale(1.3,.9) translateY(3px); }
  100% { opacity: 0;   transform: scale(1.46,.62) translateY(8px); }
}
@keyframes cv2-rumble {
  0%        { transform: translate3d(0,0,0) rotate(0deg); }
  4%        { transform: translate3d(0,4px,0) rotate(.14deg); }
  10%       { transform: translate3d(0,-2.5px,0) rotate(-.1deg); }
  18%, 100% { transform: translate3d(0,0,0) rotate(0deg); }
}
@keyframes cv2-imprint {
  0%   { opacity: 0;   transform: scale(.6,.42); }
  6%   { opacity: .92; transform: scale(1,1); }
  26%  { opacity: .62; transform: scale(1.03,.96); }
  72%  { opacity: .42; transform: scale(1.01,.94); }
  100% { opacity: 0;   transform: scale(1.07,.88); }
}
```

**结构技巧**：① 手牌与战场是两块 DOM，用"两段拼接"接上——手牌卡挂 `.cv2-play-enter` / `.cv2-play-fly`，240ms 后调 `render()`，新战场卡直接挂 `.cv2-play-slam`；② 变形只写 `scaleX()/scaleY()`；③ `rotate()` 排在 `scale()` 之后，免得形变被带成斜切。

### 7. 四种卡型的差异化演出

| 卡型 | 状态类 | 飞行参数（`--cv2-flight-y` / `-rot` / `-scale`） | 落位时长 | 差异要点 |
| --- | --- | --- | --- | --- |
| **打击** attack | `.cv2-play--attack` | -118px / -8deg / 1.2 | 300ms | 基准档：抛得不高、落得最狠，尘屑量最大，落位后压痕最深 |
| **套路** tactic | `.cv2-play--tactic` | -134px / **10deg** / 1.24 | 320ms | 抛得更高、反手旋转角度更大，落位是"甩"下来的；折角带一圈淡蓝辉光 |
| **助攻** support | `.cv2-play--support` | -88px / -4deg / 1.12 | **240ms** | 更轻更快：抬起幅度小、尘屑只到 700ms 且只扬细灰，落位保留一圈柔和绿光 |
| **大招** ult | `.cv2-play--ult` + `.cv2-play-ceremony` | **-190px** / -3deg / **1.5** | **460ms** | 更慢更重：飞行高、缩放最大；落位同时给 `<body>` 加 `.cv2-ult-ceremony` → 全屏暗角压下来（1200ms）+ 卡面爆一圈金光 + `.board` 在 180ms 处震屏 620ms（位移 -7px→6px→-4px→3px→-1.5px 逐段减半）+ 尘屑 1500ms |

### 8. 相对现状的改动清单（逐条）

1. **`.card` 的纸感底 → 做旧硬卡纸底**：22px 一道的蓝色格线不再当主底纹，改由 `.cv2-card` 的三层纸纤维 + 颗粒 + 四角發暗承担。
2. **`border: 3px solid` + 14px 圆角 → 0 边框 + 5px 圆角 + 双层内框**：牌匾要方、要有压印边。
3. **整条类型色带 → 压深硬纸横匾 + 独立名字条**：类型色只留 30% 浓度混深，名字挪进 `.cv2-name`（带虚线分界）。
4. **`.card__cost` 胶囊 → `.cv2-cost` 作业本格数**：位置从带子里挪到卡框外沿，形态由文字变可数格子（带内小胶囊可留作辅助文本）。
5. **`.card__art` 虚线蓝框 74px → 四角倒角嵌框 108 / 132px**：插画升级为卡面主体，占 45%~49% 高度。
6. **`.card__momentum` 黄胶囊 → 圆形"气"字章**：从 `top: 30px` 挪到插画右中（88 / 108px），和左上格子拉开距离。
7. **`.card__foot` + `.card__tags` → `.cv2-imprints`**：标签变成贴纸并独立成行，移到效果文本之下、角标之上。
8. **稀有度只加深压边与内辉光**：`card--ult` 不再整张换金黄纸，改 2px 金压边 + 40px 金内辉光。
9. **`.is-unplayable::after` 便利贴横条 → 红笔批注条**（`mix-blend-mode: multiply`、-2.2deg），文案仍取 `data-reason`。
10. **`.played-card` 的 `card-slam 420ms ease-pop` → `.cv2-play-slam` 300ms 五段 squash 回弹**；浅色底同步换成硬卡纸底（用 `.cv2-card--mini` 缩到 104×142）。
11. **`.card` 的 `transition: transform var(--d-normal)` → 140ms**：悬停要跟手。
12. **`.flying-card` 增加 `will-change: transform` 与 `transform-style: preserve-3d`**，让 `rotateY` 不掉帧。

**可直接粘贴的新增片段（放 `styles/card-v2.css` 末尾即可覆盖，不需要改 `cards.css`）**

```css
/* 让旧规则给新卡面让位：只影响同时带 cv2-card 的卡，旧卡面完全不受影响 */
.card.cv2-card { border: 0; border-radius: 5px; }
.card.cv2-card .card__band { border-bottom: 1px solid rgba(24, 18, 10, .45); }
.card.cv2-card .card__cost { background: rgba(0, 0, 0, .3); border-radius: 2px; }
.hand .card.cv2-card.is-unplayable::after { content: none; }
.played-card.cv2-card--mini { width: 104px; height: 142px; padding: 0; gap: 0; }
```

### 9. 性能与降级

- **`prefers-reduced-motion: reduce`**：飞行、砸落、回弹、震屏、尘屑压成 `cv2-quiet`（90ms 透明度 + 0.985 缩放）；压痕保留但不扩散（1400ms 线性淡出）；尘屑留 0.35 静态存在感；`.cv2-rumble` / `.cv2-impact` / 大招震屏 `animation: none`。
- **无 `filter`**：`@supports not (filter: brightness(1))` 去掉插画滤镜，折角改用 `box-shadow` 描边替代 `drop-shadow`。
- **无 `mix-blend-mode`**：`@supports not (mix-blend-mode: multiply)` 把做旧层降为 `opacity: .5` 的普通叠加，避免整块变黑。
- **无 `color-mix()`**（Chrome 110 以下）：退回 `--paper` → `#D8CDB4` 直出渐变；**无 `clip-path`** 时折角退方角、插画退 3px 圆角。
- **低端机**：`.cv2-lite`（JS 按 `hardwareConcurrency <= 4` 或 `deviceMemory <= 2` 给 `<html>` 加）关掉颗粒层、做旧层、尘屑细灰与折角滤镜，出牌退成 140ms 的 `cv2-lite-slam`；`@media (hover: none)` 也自动关掉做旧层。
- **通用**：只用 `transform / opacity / filter`，不新增常驻 `position: fixed` 层（大招暗角只活 1200ms）；`.fast-mode` 下所有 `cv2-` 动画压到 120ms。



---

# effects-dsl

### 效果 DSL 契约（v1）—— 代码引擎与数值设计之间的唯一接口

引擎只实现下面这些**原子操作**。数值设计里出现的每一个效果，都必须是这些操作之一。
命名保持中文，键名用英文小写。**不要发明新操作**（会直接导致卡牌无效）。

### 1. 基础术语

| 术语 | 键名 | 说明 |
| --- | --- | --- |
| 成绩 | `score` | 核心数值。开局 10，**上限 20（先到 20 直接胜利）**，**降到 0 直接失败**。 |
| 精力 | `energy` | 每回合重置的资源，上限 3（角色可改），打牌消耗。 |
| 气势 | `momentum` | 每回合开始 +1，用于大招卡，上限 5。 |
| 手牌 | `hand` | 开局 4 张，每回合抽 2 张，上限 8 张（超出弃掉）。 |
| 牌堆 | `deck` | 每人 30 张：12 张公共牌 + 18 张专属牌（角色不同）。 |
| 状态 | `status` | 见下表，带层数 `stacks`，可有 `duration`（回合数，-1=永久）。 |
| 标记 | `mark` | 只在卡牌效果里当计数用的自定义名字，引擎用 `flags` 存整数。 |

### 2. 状态表 `status`

| 状态键 | 中文名 | 效果（引擎内置，数值设计不要再写逻辑，只写层数） |
| --- | --- | --- |
| `stink` | 臭气 | 每回合结束，每层给对手 -1 成绩（注意：**建议给 duration**，永久臭气会滚雪球） |
| `sao` | 骚气 | 每层让你打出的第一张卡 +1 效果强度（伤害/回复/抽牌 +1） |
| `cringe` | 尴尬 | 每层让你回合开始少抽 0（改为：每层使你的攻击卡 -1 强度，最低 0） |
| `hype` | 声援 | 每层让对手受到的伤害 +1 |
| `bandage` | 创可贴 | 每层抵消 1 点 -成绩 |
| `acting` | 演技 | 记录层数，供刘梓嘉的卡读取（`acting` 层数越高，部分卡越强） |
| `followers` | 干儿子 | 任乐的召唤物层数，每层每回合结束 +1 成绩 |
| `shield` | 面子上过得去 | 每层抵消 1 点 -成绩，回合结束清零 |
| `silence` | 被点名 | 每层让你下一张卡无效（消费 1 层） |
| `spotlight` | 众目睽睽 | 每层让对手回合开始 -1 成绩 |
| `mark` | 被记名 | 每层让记录者对你的卡 +1 强度 |
| `haste` | 赶作业 | 每层每回合开始多抽 1 张 |
| `tilt` | 心态崩 | 每层让你回合开始弃 1 张牌 |
| `buff` | 状态不错 | 每层让你回合结束 +1 成绩 |

- 伤害/回复统一走 `score` 增减，`-score` 会被 `shield` / `bandage` 吸收。

### 3. 效果操作 `ops`

每个效果是一个对象，`op` 必填。`target` 默认 `opp`。

### 数值类
- `{ "op": "damage", "value": 2, "target": "opp" }` —— 对手 -2 成绩（受 hype/cringe/shield/bandage 影响）
- `{ "op": "heal", "value": 2, "target": "self" }` —— 自己 +2 成绩
- `{ "op": "drain", "value": 1 }` —— 对手 -1，自己 +1
- `{ "op": "setScore", "value": 12, "target": "self" }` —— 直接把成绩设为某值

### 资源类
- `{ "op": "draw", "value": 2 }`
- `{ "op": "discard", "value": 1, "target": "opp" }` —— 对手随机弃 1 张
- `{ "op": "gainEnergy", "value": 1 }`
- `{ "op": "gainMomentum", "value": 1 }`
- `{ "op": "loseMomentum", "value": 1, "target": "opp" }`

### 状态类
- `{ "op": "applyStatus", "status": "stink", "value": 1, "target": "opp", "duration": -1 }`
- `{ "op": "removeStatus", "status": "stink", "value": 1, "target": "opp" }`
- `{ "op": "clearStatus", "status": "tilt", "target": "self" }`
- `{ "op": "transferStatus", "status": "stink", "value": 1, "from": "self", "to": "opp" }`

### 标记类
- `{ "op": "addFlag", "flag": "ball", "value": 1 }`
- `{ "op": "consumeFlag", "flag": "ball", "value": 1 }`
- `{ "op": "scaleByFlag", "flag": "ball", "then": [ ...ops ] }` —— 用标记数放大后续效果（`value` 乘以层数并入后续 op 的 `value`）

### 条件类
- `{ "op": "if", "cond": <cond>, "then": [ ...ops ], "else": [ ...ops ] }`
- `{ "op": "repeat", "times": 2, "ops": [ ...ops ] }` —— 重复执行
- `{ "op": "choose", "prompt": "选一项", "options": [ { "label": "A", "ops": [...] }, { "label": "B", "ops": [...] } ] }`

### 特殊类
- `{ "op": "searchDeck", "value": 1, "filter": "专属" }` —— 从牌堆找 1 张专属牌加入手牌
- `{ "op": "recoverFromDiscard", "value": 1 }` —— 从弃牌堆回收 1 张
- `{ "op": "extraTurn", "value": 1 }` —— 追加回合（**每局每角色最多 1 次**）
- `{ "op": "copyLastCard" }` —— 复制本回合上一张牌的效果
- `{ "op": "revealHand", "target": "opp" }` —— 亮出对手手牌（本回合可见）
- `{ "op": "cancelNext", "target": "opp" }` —— 使对手下一张牌无效

### 条件表达式 `cond`（只能是下面几种）
```json
{ "type": "scoreBelow", "who": "opp", "value": 10 }
{ "type": "scoreAbove", "who": "self", "value": 14 }
{ "type": "statusAtLeast", "who": "opp", "status": "stink", "value": 2 }
{ "type": "flagAtLeast", "flag": "ball", "value": 2 }
{ "type": "handAtLeast", "who": "self", "value": 5 }
{ "type": "energyAtLeast", "value": 2 }
{ "type": "turnAtLeast", "value": 4 }
{ "type": "not", "cond": { ... } }
{ "type": "and", "conds": [ ... ] }
{ "type": "or", "conds": [ ... ] }
```

### 4. 触发时机（被动/装备类使用）
`trigger` 取值：`turnStart`（自己回合开始）、`turnEnd`、`onDamage`（自己被打）、`onDealDamage`、`onPlayCard`、`onDraw`、`onOppPlayCard`、`onScoreChange`、`oncePerGame`。

### 5. 卡牌对象结构
```json
{
  "id": "zhangkaiyao_03",
  "name": "倒挂金钩",
  "type": "attack",            // attack | tactic | support | ult
  "cost": 1,                    // 精力消耗 0~3
  "momentum": 0,                // 需要的气势（大招卡常用 2~3，普通卡 0）
  "rarity": "common",           // common | rare | epic
  "text": "造成 2 点成绩打击；若你有【骚气】，改为 3 点。",
  "tags": ["足球"],
  "ops": [ ... ],
  "count": 2,                   // 牌堆里放几张
  "art": "art/cards/zhangkaiyao_03.svg"
}
```

### 6. 角色对象结构
```json
{
  "id": "zhangkaiyao",
  "name": "张凯尧",
  "nickname": "骚哥",
  "gender": "男",
  "tagline": "一句话人设",
  "desc": "两句话角色介绍",
  "hpScoreStart": 10,
  "energyMax": 3,
  "momentumStart": 1,
  "passive": { "name": "被动名", "text": "描述", "ops": [ ... ], "trigger": "turnStart" },
  "ult": { "id": "zhangkaiyao_ult", "name": "大招名", "cost": 0, "momentum": 3, "type": "ult", "text": "...", "ops": [ ... ], "count": 1, "art": "..." },
  "portrait": "art/portraits/zhangkaiyao.svg",
  "icon": "art/icons/zhangkaiyao.svg",
  "themeColor": "#hex",
  "decks": [ ...卡牌对象... ],
  "strategy": "一句话打法说明（给玩家看的）"
}
```

**平衡硬指标**：单角色 18 张专属牌（含 1 张 ult）+ 12 张公共牌 = 30 张牌堆。
单卡最高直接打击不超过 4 点；大招不超过 6 点（可用条件换取更高收益）。不许出现"直接获胜"的卡。



---

# characters-brief

### 《八班风云》原始素材（用户提供，不可更改事实）

> 这是一款**校园卡牌对战网页游戏**，玩家选择一名同学出战，用各自的"绝活卡池"对决。
> 世界观：八班的课间江湖。没有帮派、没有军争、没有主公忠臣，有的只是**成绩、面子、名声、人缘**。
> 风格基调：**搞笑、夸张、有梗、青春校园**，像学生时代互相玩梗那样热闹，绝不低俗、不血腥、不涉黄、不涉及真实伤害。

### 角色原型（用户原话整理）

### 角色 1：张凯尧
- 外号：**骚哥**
- 性别：男
- 特点：经常做吐舌头的动作，因此得名"骚哥"
- 爱好：足球。喜欢北京国安、皇家马德里、曼联三支球队；喜欢玩实况足球（足球游戏）
- 体型：比较胖
- 可再加工方向：舌头、庆祝动作、球队信仰、解说腔、替补席、乌龙球、加时赛

### 角色 2：刘梓嘉
- 性别：女
- 特点：喜欢把自己包装成"心里有很多事"的人设（同学眼里是"戏精/人设党"），有一堆说不清真假的"身体不舒服"表现
- 其他：喜欢给自己弄些夸张的小伤口造型（贴创可贴、缠纱布那种"造型感"）；抽烟
- **重要合规要求（必须遵守）**：这是校园搞笑向作品，**绝对不能**出现自伤、自杀、抑郁病症的写实描写或美化，也不要把精神疾病当作笑点。改写为**完全无害的校园梗**：创可贴/纱布当"造型配饰"、保温杯当"烟"（电子烟道具改成"奶茶杯/棒棒糖"）、把"装病"改成"装受伤/装委屈/请假条/演技派"，可命名为"演员的自我修养""请假条""创可贴美学""人设"。任何"受伤"都是**夸张的舞台效果**，场上数值用"形象分/关注度"表示，不做写实伤害描写。
- 可再加工方向：演技、镜头感、创可贴、请假条、围观群众、热搜、剧本、NG 重来

### 角色 3：任乐
- 性别：男
- 体型：很胖
- 爱好：打王者荣耀（手机 MOBA 游戏）
- 外号：被同学叫"妈妈"、"猪乐子"
- 特点：有很多"干儿子/干女儿"，名义上"一胎八个"，大概有 6 胎（纯同学玩笑梗）
- 特点：说话喜欢带手势（比划、打手语似的）
- 可再加工方向：开团/上分、队友/干儿子军团、手势指挥、营养快线、饭点、召唤流

### 角色 4：于浩天
- 外号：**大菠萝**
- 特点：头很圆，喜欢留寸头（发型即武器）
- 特点：喜欢上课放屁，而且很臭（**用"臭气/生化武器"这种卡通化、去生理化的方式处理，禁止低俗描写**）
- 特点：喜欢去找学姐学妹待着，虽然特别不受待见（→ 表现为"搭讪失败/被拉黑/被请去办公室"）
- 特点：特别"嘉豪"（同学间的梗词，指爱装、爱逞能、总爱把事情搞大的那种人），干的"嘉豪事情"会拉着普通人一起下水
- 其他：是体育委员（体委），但体育成绩一般；说话不清晰（口齿不清、含糊）
- 可再加工方向：寸头、圆头、魔性口音、体委袖标、连累队友、臭气领域

### 交付约束
- 出现名字的必须是这 4 位，其他可以加 NPC 路人（学姐、学妹、班主任、隔壁班）作为卡牌名/背景板，不要加真实人名。
- 所有文本避免任何歧视性表述（体型、性别、地域都不许开恶意玩笑），调侃要"往可爱和热闹的方向走"，角色自己也要有高光时刻，不做单方面丑化。
