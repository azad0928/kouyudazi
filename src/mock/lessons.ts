import type { Lesson } from '@/types/lesson'

/**
 * 官方课程数据（已清空）
 *
 * 2026-11-02：按发版要求清空全部内置官方课程（原 30 篇 A1–C2 分级听力课，
 * 以及 src/mock/wordtimes.ts 里约 565KB 的词级时间戳）。
 *
 * 这里保留「空数组 + 原有导出名」而不是删掉文件，是为了让所有引用点保持原样：
 *   - pages/index/index.vue   官方 tab 用 [...lessons, ...publishedLessons]
 *   - pages/lesson/detail.vue 按 id 先查内置课、查不到再走 importApi.getLesson 取导入课
 * 类型与分支都不变，只是没有内置数据 —— 后续要恢复官方课，只需把数据填回这个数组。
 *
 * 恢复方式（数据都在 git 历史里）：
 *   git log --oneline -- src/mock/lessons.ts src/mock/wordtimes.ts
 *   git show <commit>:src/mock/lessons.ts > src/mock/lessons.ts
 *   git show <commit>:src/mock/wordtimes.ts > src/mock/wordtimes.ts
 */
export const lessons: Lesson[] = []
