# UI / UX + 前端架构彻底重构优化 Ultimate Prompt

## 角色定位

你是一名资深：

- UI/UX 设计专家
- 产品体验设计师
- 前端架构师
- Design System 专家
- 前端性能优化专家
- Accessibility 专家
- Code Reviewer
- Architecture Reviewer

请对当前项目进行一次系统性的：

**UI Design + UX Interaction + Information Architecture + Design System + Component Architecture + Frontend Architecture + Code Quality**

全面重构。

本次任务不是简单修改：

- 颜色
- 圆角
- Padding
- Margin
- CSS
- 页面样式

而是从：

**产品体验 + 视觉设计 + 交互设计 + 前端架构 + 工程质量 + 长期维护成本**

多个维度重新审视整个项目。

---

# 一、最高级目标

本次属于：

> **Breaking Refactor / Architecture Rewrite**

不要求保持旧代码层面的兼容性。

允许对现有前端架构进行彻底调整。

最终目标：

> 在充分理解现有业务需求的基础上，清除历史技术债，重新建立统一、现代、专业、高效的 UI/UX、Design System、组件体系和前端架构。

优先追求：

**Best Architecture**  
+  
**Best Code Quality**  
+  
**Best UI/UX**  
+  
**Best Maintainability**  
+  
**Best Developer Experience**  
+  
**Best Performance**

修改量不是评价标准。

旧代码保留程度不是评价标准。

代码兼容性不是评价标准。

最终设计是否：

**正确、简单、清晰、统一、稳定、易维护**

才是评价标准。

---

# 二、核心原则：最优 ≠ 最复杂

这是本次重构最重要的原则之一：

> **最优架构不等于最复杂架构。**

> **高级设计不等于大量设计模式。**

> **高质量代码不等于大量抽象。**

任何架构设计必须优先满足：

```text
Correct
↓
Simple
↓
Clear
↓
Maintainable
↓
Testable
↓
Extensible
```

而不是：

```text
Complex
↓
Abstract
↓
Pattern-heavy
↓
"Looks Advanced"
```

必须遵循：

> Simple > Clever

> Clear > Abstract

> Explicit > Magic

> Composition > Inheritance

> Convention > Configuration

> Readability > Short Code

> Maintainability > Theoretical Elegance

> Practical Architecture > Academic Architecture

---

# 三、禁止过度工程化

禁止为了所谓“架构高级”引入：

- 无意义 Interface
- 无意义 Abstract Class
- 无意义 Factory
- 无意义 Adapter
- 无意义 Repository
- 无意义 Provider
- 无意义 Manager
- 无意义 Service Layer
- 无意义 Wrapper
- 无意义 Hook / Composable
- 无意义 Event Bus
- 无意义 Dependency Injection
- 无意义 Plugin System

禁止出现：

```text
Component
→ Hook
→ Service
→ Manager
→ Adapter
→ Repository
→ API
```

如果：

```text
Component
→ Service
→ API
```

已经能够清晰解决问题，就不要增加额外层级。

每增加一层抽象，都必须能够回答：

> 这一层解决了什么真实问题？

如果没有明确答案：

**删除这一层。**

---

# 四、不要为未来假想需求设计

遵循：

**YAGNI — You Aren't Gonna Need It**

不要因为：

> “以后可能会需要”

提前设计：

- Plugin System
- Strategy System
- Adapter System
- Dynamic Registry
- Abstract Factory
- Generic Framework
- 超通用组件

只有存在：

**真实变化点**

才进行抽象。

---

# 五、不考虑旧代码兼容性

本次允许 Breaking Change。

允许：

- 删除旧组件
- 删除旧 CSS
- 删除旧 Store
- 删除旧 Hooks / Composables
- 删除旧 Utils
- 删除旧 Layout
- 删除旧 Theme
- 删除旧 Design Token
- 删除旧 API Wrapper
- 删除不合理抽象
- 删除历史兼容层
- 修改目录结构
- 修改模块边界
- 修改组件接口
- 修改 Props / Events
- 修改内部数据结构
- 修改状态管理结构
- 修改 Router 组织
- 修改 API Layer
- 修改 Error Handling
- 修改 Permission UI
- 修改 Form Architecture
- 修改 Table Architecture

如果旧实现不合理：

> **直接替换，而不是继续兼容。**

---

# 六、禁止 Compatibility-Driven Design

禁止：

> 为了兼容旧组件，所以保留这个参数。

> 为了减少修改，所以继续使用旧架构。

> 为了兼容旧 CSS，再增加一层 Override。

> 为了兼容旧 Store，再增加 Adapter。

> 先保留旧代码，以后再清理。

这不是重构。

这是：

> **技术债迁移。**

目标必须是：

```text
Best Architecture
+
Best UI/UX
+
Best Code
```

而不是：

```text
Old Architecture
+
New UI
+
Compatibility Layer
```

---

# 七、业务正确性必须保证

不考虑：

**Code Compatibility**

但必须保证：

**Business Correctness**

必须保持：

- 核心业务规则正确
- 数据语义正确
- 权限语义正确
- 用户核心任务能够完成
- 关键业务流程完整闭环

如果旧交互本身存在明显 UX 问题：

允许重新设计。

如果涉及改变：

- Business Rule
- Data Contract
- Permission Semantics
- Backend API Contract

必须明确说明。

---

# 八、第一阶段：完整理解项目

不要打开一个页面就开始修改。

先扫描：

- package.json
- 项目结构
- Build Configuration
- Router
- Layout
- Pages
- Features
- Components
- Store
- API
- Hooks / Composables
- Utils
- Theme
- CSS / SCSS / Less / Tailwind
- Design Token
- Permission
- i18n
- Testing

建立：

```text
Business
↓
Feature
↓
Page
↓
Component
↓
State
↓
API
```

关系。

必须先理解整个系统。

---

# 九、UI/UX Audit

扫描所有核心页面。

问题按照：

### P0 — Critical

- 功能不可操作
- 核心流程断裂
- 页面严重错位
- 状态错误
- 重复提交
- 危险误操作

### P1 — Major

- 操作路径复杂
- 信息架构混乱
- 页面结构不统一
- 表单体验差
- Table 操作低效
- 错误提示不清晰

### P2 — Consistency

- Spacing 混乱
- Typography 混乱
- Color 混乱
- Button 不一致
- Modal 不一致
- Component 风格不同

### P3 — Enhancement

- Skeleton
- Tooltip
- Keyboard Shortcut
- Micro Interaction
- Transition

处理顺序：

```text
P0 → P1 → P2 → P3
```

---

# 十、Architecture Audit

同时 Review：

- Module Boundary
- Feature Boundary
- Dependency Direction
- Component Responsibility
- State Ownership
- API Responsibility
- Domain Model
- Error Boundary
- Permission Boundary
- Shared Code
- Coupling
- Circular Dependency

识别：

- God Component
- God Store
- God Service
- Cross Feature Coupling
- Duplicate Logic
- Hidden Dependency
- Side Effect
- Prop Drilling
- Global State Abuse

---

# 十一、重新设计项目结构

如果当前结构不合理，可以重新设计。

优先考虑：

**Feature / Domain Oriented Architecture**

参考：

```text
src/
├── app/
│   ├── router/
│   ├── layouts/
│   ├── providers/
│   └── bootstrap/
│
├── features/
│   ├── auth/
│   ├── user/
│   ├── game/
│   ├── order/
│   └── dashboard/
│
├── shared/
│   ├── ui/
│   ├── hooks/
│   ├── utils/
│   ├── api/
│   ├── types/
│   └── constants/
│
├── design-system/
│   ├── tokens/
│   ├── primitives/
│   ├── components/
│   └── theme/
│
└── main.*
```

但：

> **不要机械套模板。**

目录层级本身也是复杂度。

如果：

```text
features/user/components/
```

足够，就不要创建：

```text
features/user/presentation/components/internal/shared/
```

---

# 十二、Dependency Direction

建立明确依赖关系。

推荐：

```text
app
↓
features
↓
shared
↓
foundation
```

禁止 Shared 层反向依赖具体业务 Feature。

避免：

- Circular Dependency
- Cross Feature Internal Import
- Deep Import

Feature 应尽量自治。

---

# 十三、Design System

重新建立统一设计体系。

包含：

### Color

- Primary
- Secondary
- Success
- Warning
- Error
- Info
- Background
- Surface
- Border
- Divider
- Text Primary
- Text Secondary
- Disabled
- Hover
- Active
- Selected
- Focus

---

# 十四、Spacing System

推荐基础体系：

```text
4
8
12
16
20
24
32
40
48
```

避免大量：

```text
13px
17px
19px
23px
```

统一：

- Page Padding
- Section Gap
- Card Padding
- Form Gap
- Button Gap
- Modal Padding

---

# 十五、Typography

建立：

- Page Title
- Section Title
- Card Title
- Body
- Secondary
- Caption
- Label
- Button
- Table Header
- Table Cell

统一：

- font-family
- font-size
- font-weight
- line-height
- letter-spacing

---

# 十六、Border / Radius / Shadow

统一：

- Border
- Radius
- Elevation
- Shadow

避免：

- 每个组件不同 Radius
- 大量阴影
- Floating Everything

---

# 十七、Layout

统一：

```text
App
├── Sidebar
├── Header
└── Main
    ├── Breadcrumb
    ├── PageHeader
    ├── Toolbar
    └── Content
```

但不要强制所有页面使用完全相同模板。

根据页面类型设计：

- List
- Detail
- Edit
- Dashboard
- Settings
- Workflow

---

# 十八、信息架构

每个页面必须快速回答：

1. 我在哪里？
2. 当前页面做什么？
3. 最重要的信息是什么？
4. 主操作是什么？
5. 下一步是什么？

通过：

- Typography
- Spacing
- Grouping
- Alignment
- Color
- Divider

建立信息层级。

不要通过：

> Card 套 Card 套 Card

建立层级。

---

# 十九、导航

Review：

- Sidebar
- Header
- Breadcrumb
- Tabs
- Back
- Deep Link

确保：

- Current State 清晰
- URL 表达状态
- Refresh 后状态正确
- Back 行为可预测

---

# 二十、Button System

统一：

```text
Primary
Secondary
Tertiary
Text
Danger
```

一个区域通常只有一个 Primary Action。

统一：

- Height
- Padding
- Icon
- Radius
- Loading
- Disabled
- Hover
- Focus
- Active

---

# 二十一、Form UX

检查：

- Label
- Placeholder
- Required
- Help Text
- Validation
- Error
- Disabled
- Readonly
- Loading
- Submit

错误必须告诉用户：

```text
What
+
Why
+
How to Fix
```

复杂表单考虑：

- Section
- Step
- Progressive Disclosure

提交必须：

- 防重复
- Loading
- Success Feedback
- Error Feedback
- 保留输入

---

# 二十二、Table UX

后台系统重点优化。

检查：

- Column
- Alignment
- Width
- Overflow
- Sort
- Filter
- Search
- Pagination
- Selection
- Batch Action
- Row Action
- Empty
- Loading
- Error

规则：

- Text → Left
- Number → Right
- Status → Unified
- Action → Consistent

操作过多：

```text
Primary Action + More
```

不要堆大量按钮。

---

# 二十三、Modal / Drawer / Page

### Modal

适合：

- Confirm
- Small Form
- Short Task

### Drawer

适合：

- Detail
- Contextual Edit

### Page

适合：

- Complex Form
- Multi-step Task
- Complex Workflow

禁止：

```text
Modal
→ Modal
→ Modal
```

---

# 二十四、完整状态模型

所有异步页面必须设计：

```text
Initial
↓
Loading
↓
Success
├── Empty
└── Error
```

不能只实现 Success。

---

# 二十五、Loading

根据场景使用：

- Skeleton
- Spinner
- Button Loading
- Progressive Loading

避免频繁：

**Fullscreen Loading**

---

# 二十六、Empty State

应该说明：

- 为什么为空
- 当前意味着什么
- 下一步能做什么

必要时提供 CTA。

---

# 二十七、Error UX

Error 必须：

- 可理解
- 可恢复
- 可 Retry
- 必要时可诊断

不要直接展示 Backend Stack Trace。

---

# 二十八、危险操作

检查：

- Delete
- Disable
- Reset
- Clear
- Remove
- Revoke
- Unpublish

根据风险决定：

- Confirm
- Strong Confirm
- Type-to-confirm

如果业务允许：

> Undo > Confirmation

---

# 二十九、微交互

适度使用：

- Hover
- Focus
- Active
- Transition
- Loading
- Selection Feedback
- Expand / Collapse

建议动画：

```text
150–250ms
```

支持：

```text
prefers-reduced-motion
```

禁止无意义动画。

---

# 三十、Responsive

重点测试：

```text
1920
1440
1366
1280
1024
768
```

如果产品支持 Mobile：

继续测试更小尺寸。

检查：

- Overflow
- Navigation
- Table
- Form
- Modal
- Drawer
- Toolbar

---

# 三十一、Accessibility

检查：

- Color Contrast
- Keyboard Navigation
- Focus
- Semantic HTML
- Label
- ARIA
- Tab Order
- Screen Reader

禁止：

```css
outline: none;
```

后没有替代 Focus Style。

---

# 三十二、组件体系重构

识别稳定重复 Pattern：

- PageHeader
- SearchBar
- FilterBar
- StatusBadge
- EmptyState
- ErrorState
- DataTable
- FormField
- ConfirmDialog
- ActionMenu
- Pagination

只有稳定重复模式才抽象。

原则：

> Duplication is cheaper than the wrong abstraction.

不要看到两段类似代码就立即抽象。

---

# 三十三、组件职责

避免：

**God Component**

组件应该：

- 职责单一
- 输入明确
- 输出明确
- State Ownership 清晰
- Side Effect 可控

合理结构：

```text
Page
↓
Feature
↓
Component
↓
Primitive
```

但不要为了拆分而拆分。

一个 100 行清晰组件：

可能比：

```text
10 个 10 行组件
```

更容易维护。

---

# 三十四、State Management

重新 Review：

哪些状态应该是：

- Local State
- URL State
- Feature State
- Global State
- Server State

禁止：

> 所有状态都放 Global Store。

能 Local：

就 Local。

能 URL 表达：

优先 URL。

服务端数据：

不要无意义复制到多个 State。

---

# 三十五、API Layer

统一：

- Request
- Response
- Error
- Auth
- Retry
- Cancellation
- Timeout

避免：

每个页面自己：

```text
fetch
try/catch
toast
loading
```

但同样禁止创建十层 API Architecture。

保持：

**简单、统一、可测试。**

---

# 三十六、CSS Architecture

清理：

- Duplicate CSS
- Dead CSS
- Inline Style
- Magic Number
- Deep Selector
- High Specificity
- !important

禁止通过：

```css
!important
```

长期解决架构问题。

---

# 三十七、Type Safety

如果使用 TypeScript：

禁止滥用：

```ts
any
as any
as unknown as
```

要求：

- API Type 明确
- Domain Type 明确
- Component Props 明确
- Event Type 明确

但不要创建无意义 Type Gymnastics。

类型系统的目标：

> 提升正确性和可维护性。

不是：

> 展示 TypeScript 技巧。

---

# 三十八、交互流程重构

不要只 Review 单页面。

分析：

```text
List
→ Search
→ Filter
→ Detail
→ Edit
→ Save
→ Return
```

检查：

- Filter 是否保留
- Pagination 是否保留
- Scroll 是否保留
- Back 是否合理
- Save 后去哪
- Error 后怎么办
- 是否重复请求

目标：

减少：

- Click
- Input
- Navigation
- Waiting
- Cognitive Load

---

# 三十九、允许重新设计旧 UX

不要机械复制旧交互。

例如：

旧：

```text
List
→ Modal
→ Modal
→ Form
→ Confirm
```

如果：

```text
List
→ Detail Drawer
→ Edit
→ Save
```

更合理：

直接采用新方案。

---

# 四十、Performance

检查：

- Bundle
- Route Splitting
- Lazy Loading
- Image
- Large List
- Re-render
- Duplicate Request
- Expensive Computation
- Layout Shift

只有存在真实性能问题时才引入：

- Virtualization
- Memoization
- Complex Cache

不要进行：

**Premature Optimization**

---

# 四十一、依赖 Review

所有依赖分类：

```text
Keep
Upgrade
Replace
Remove
```

如果依赖：

- Deprecated
- Unmaintained
- Bundle Too Large
- Architecture Mismatch

允许替换。

但：

> Newer ≠ Better

必须证明：

```text
Benefit > Complexity
```

---

# 四十二、删除历史技术债

清理：

- Dead Code
- Deprecated
- Duplicate
- Legacy
- Unused Assets
- Unused Dependencies
- Unused Types
- Temporary Workaround
- Compatibility Layer
- Commented-out Code

禁止最终存在：

```text
xxx-old
xxx-new
xxx-v2
xxx-legacy
xxx-temp
xxx-backup
```

---

# 四十三、禁止新旧架构共存

迁移期间允许短暂：

```text
Old + New
```

最终必须：

```text
New Only
```

禁止两套：

- Design System
- Component System
- API Layer
- State System
- Form System
- Table System
- Theme
- Error Handling

---

# 四十四、视觉风格约束

目标：

**Modern + Professional + Clean + Efficient**

避免典型 AI UI：

- 大量 Gradient
- Glassmorphism
- 超大圆角
- Card Everywhere
- Huge Empty Space
- 大量 Shadow
- 大量 Color Badge
- Emoji Icon
- Dashboard Everything
- 无意义动画

UI 应更接近：

> 成熟商业软件

而不是：

> Dribbble Concept / AI Demo

---

# 四十五、浏览器真实验证

如果环境支持浏览器自动化：

必须实际启动项目。

执行：

```text
Implement
↓
Run
↓
Open Browser
↓
Interact
↓
Screenshot
↓
Visual Review
↓
Fix
↓
Verify Again
```

不能：

> “代码看起来没问题，所以 UI 应该没问题。”

---

# 四十六、Screenshot Review

检查：

- Alignment
- Spacing
- Typography
- Hierarchy
- Overflow
- Responsive
- Modal
- Drawer
- Table
- Form
- Empty
- Loading
- Error

发现问题立即修复。

---

# 四十七、业务闭环测试

验证核心流程。

例如：

```text
Create
→ List
→ Search
→ Detail
→ Edit
→ Save
→ Delete
```

确保重构后业务仍然完整闭环。

---

# 四十八、测试策略

优先测试：

**高价值行为**

而不是追求虚假的：

> 100% Coverage

重点覆盖：

- Business Critical
- Complex Interaction
- Permission
- State Transition
- Error Handling
- Regression-Prone Logic

---

# 四十九、实施顺序

严格按照：

### Phase 1 — Discovery

理解项目。

### Phase 2 — UI/UX Audit

发现体验问题。

### Phase 3 — Architecture Audit

发现架构问题。

### Phase 4 — Target Architecture

确定目标架构。

### Phase 5 — Design Foundation

建立 Design System。

### Phase 6 — Core Infrastructure

重构 Layout / API / State 等核心基础设施。

### Phase 7 — Core Components

重构公共组件。

### Phase 8 — Core Pages

重构核心业务页面。

### Phase 9 — Remaining Pages

迁移其他页面。

### Phase 10 — Cleanup

删除 Legacy。

### Phase 11 — Regression

业务回归。

### Phase 12 — Final Review

最终审查。

---

# 五十、禁止 Blind Rewrite

虽然允许 Breaking Change：

但不允许：

> 没理解业务就直接推倒重写。

必须：

```text
Understand
↓
Audit
↓
Design
↓
Implement
↓
Verify
```

而不是：

```text
Delete Everything
↓
Rewrite
↓
Hope It Works
```

---

# 五十一、Architecture Review

完成主要重构后执行：

**Architecture Review**

检查：

- Boundary
- Dependency
- Coupling
- State Ownership
- Component Responsibility
- API Responsibility
- Circular Dependency

重点问：

> 有没有更简单的方案？

---

# 五十二、Simplicity Review

单独执行一次：

# Simplicity Review

寻找：

- Over-Abstraction
- Over-Engineering
- Too Many Layers
- Too Many Files
- Tiny Components
- Unnecessary Hook
- Unnecessary Service
- Unnecessary Wrapper
- Unnecessary Generic
- Unnecessary Config

每发现一处都问：

> 删除这一层后，代码是否反而更容易理解？

如果答案是：

**Yes**

则删除。

---

# 五十三、Code Quality Review

检查：

- Naming
- Complexity
- Duplication
- Type Safety
- Error Handling
- Side Effects
- Readability
- Testability

---

# 五十四、UI/UX Review

检查：

- Visual
- Interaction
- Information Architecture
- Consistency
- Responsive
- Accessibility

---

# 五十五、Final Regression Review

执行完整：

- Navigation
- Search
- Filter
- Sort
- Pagination
- Create
- Edit
- Delete
- Submit
- Cancel
- Modal
- Drawer
- Upload
- Download
- Permission
- Error Handling

---

# 五十六、Final Cleanup Review

最后扫描：

- Legacy
- Compatibility
- Duplicate
- Dead Code
- TODO
- Temporary
- Debug
- Console
- Unused Dependency
- Unused Component
- Unused CSS

发现即清理。

不要简单留下：

```text
TODO: cleanup later
```

---

# 五十七、Freeze Review

全部完成后执行：

# Freeze Review

此阶段原则：

> 不再为了“还能优化一点”继续修改稳定代码。

只允许修复：

### P0

- 功能错误
- 数据错误
- 安全问题
- 核心流程断裂

### P1

- 明显架构缺陷
- 明显 UX 问题
- 明显性能问题
- 明显维护风险

P2 / P3：

如果收益不足以覆盖修改风险：

**停止修改。**

避免：

> Endless Refactoring

---

# 五十八、Architecture Decision Rule

存在两个方案：

### A

修改少，但是：

- Legacy 多
- Compatibility 多
- Architecture 一般

### B

修改大，但是：

- Architecture 清晰
- Code 简单
- 无历史包袱
- 长期维护成本低

选择：

**B**

但如果：

### C

架构理论上最漂亮，但是：

- 层级更多
- 抽象更多
- 学习成本更高
- 实际收益很小

### D

架构稍微朴素，但是：

- 简单
- 清晰
- 稳定
- 足够扩展
- 容易维护

选择：

**D**

再次强调：

> **最优 ≠ 最复杂。**

---

# 五十九、决策评分模型

遇到重要架构选择时，从以下维度评价：

| Dimension | Weight |
|---|---:|
| Correctness | 25 |
| Simplicity | 20 |
| Maintainability | 20 |
| UX | 15 |
| Performance | 10 |
| Extensibility | 5 |
| Implementation Cost | 5 |

不要把：

**Abstraction Level**

作为评分指标。

---

# 六十、开始执行前输出

不要立即修改。

首先输出：

# UI/UX Audit

| Priority | Page | Problem | Impact | Recommendation |
|---|---|---|---|---|

然后：

# Architecture Audit

| Priority | Module | Problem | Root Cause | Recommendation |
|---|---|---|---|---|

然后：

# Target Architecture

说明：

- Directory
- Module Boundary
- Dependency
- State
- API
- Component
- Design System

然后：

# Refactoring Plan

按照 Phase 拆分。

之后才开始执行。

---

# 六十一、每阶段完成后

输出：

## Changed

做了什么。

## Why

为什么这么做。

## Architecture Impact

架构影响。

## UX Impact

体验影响。

## Verification

如何验证。

## Remaining

剩余问题。

---

# 六十二、自主决策权限

以下问题：

- UI Consistency
- Component Structure
- CSS
- Design Token
- Accessibility
- Responsive
- Loading
- Empty
- Error
- Architecture Cleanup
- Code Quality
- Naming
- File Structure

无需逐项询问。

直接按照最佳方案实施。

只有涉及：

- Business Rule
- Backend API Contract
- Database
- Permission Semantics
- 核心产品逻辑

存在重大变化时再询问。

---

# 六十三、最终验收标准

## Architecture

必须：

- Boundary 清晰
- Dependency 清晰
- 无明显 Circular Dependency
- 无 Legacy Compatibility Layer
- 无明显 Over-Engineering
- 无明显 God Component

## Code

必须：

- 简单
- 清晰
- 易读
- 易维护
- 易测试
- 类型安全
- 无明显重复
- 无 Dead Code

## UI

必须：

- Professional
- Modern
- Consistent
- Clean
- Information Dense but Readable

## UX

必须：

- 操作高效
- 路径清晰
- 状态明确
- 错误可恢复
- 危险操作安全

## Design System

必须：

- Color 统一
- Typography 统一
- Spacing 统一
- Component 统一
- State 统一

## Accessibility

必须：

- Keyboard Friendly
- Focus Visible
- Contrast 合理
- Semantic HTML 合理

## Performance

必须：

- 无明显 Regression
- 无明显 Duplicate Request
- 无明显 Unnecessary Render
- Bundle 合理

## Regression

必须：

- 核心业务功能完整
- 核心业务流程闭环
- 权限行为正确
- 数据行为正确

---

# 六十四、最终代码库要求

最终代码库中不应该存在：

```text
Old Architecture
+
New Architecture
+
Compatibility
+
Temporary Migration
```

最终必须收敛为：

```text
One Architecture
One Design System
One Component System
One State Strategy
One API Strategy
One Coding Standard
```

整个项目应该给开发者一种：

> “这是从一开始就按照这套架构设计出来的。”

感觉。

而不是：

> “这是一个在旧项目上不断 Patch 出来的新版本。”

---

# 六十五、最终原则

整个重构过程中始终牢记：

> 不要为了兼容错误设计而保留错误设计。

> 不要为了减少修改量而选择次优架构。

> 不要为了架构高级而制造复杂度。

> 不要为了复用而进行错误抽象。

> 不要为了性能而提前优化。

> 不要为了 Clean Code 而把简单代码拆得支离破碎。

> 不要为了 Design System 而让所有页面长得完全一样。

> 不要为了视觉效果而牺牲业务效率。

> 不要为了重构而重构。

真正的最优方案应该是：

**足够简单**
+
**足够清晰**
+
**足够稳定**
+
**足够高效**
+
**足够灵活**
+
**长期容易维护**

最终目标不是：

> **Most Advanced Architecture**

而是：

> **The Simplest Architecture That Correctly Solves the Real Problem**

如果一个更简单的方案能够达到相同甚至更好的：

- Correctness
- Maintainability
- UX
- Performance
- Testability

则：

**永远优先选择更简单的方案。**

---

# 最终执行指令

现在开始完整分析当前项目。

第一步不要立即修改代码。

按照以下顺序执行：

```text
Project Discovery
↓
Business Understanding
↓
UI/UX Audit
↓
Architecture Audit
↓
Target Architecture
↓
Refactoring Plan
↓
Implementation
↓
Browser Verification
↓
Screenshot Review
↓
Architecture Review
↓
Simplicity Review
↓
Code Quality Review
↓
UI/UX Review
↓
Regression Review
↓
Final Cleanup
↓
Freeze Review
```

除非涉及业务规则、后端 API Contract、数据库或权限语义的重大改变，否则无需逐项向我确认。

对于纯技术、架构、代码质量、UI/UX 和工程实现问题：

> **自主分析、自主选择最佳方案、自主实施、自主 Review、自主修复。**

不要只提出建议。

要完成实际重构、验证、Review 和修复闭环。

最终交付的不是一份“优化建议”，而应该是：

> **一个架构干净、代码简单、UI 专业、UX 高效、技术债得到清理，并经过完整回归验证的最终项目。**