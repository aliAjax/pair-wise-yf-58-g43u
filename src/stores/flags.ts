import { defineStore } from 'pinia';

export type ReleaseStatus = 'pending' | 'live' | 'obsolete';
export interface RuleSet { region: string; appVersion: string; authenticated: boolean; }
export interface Approval { role: string; commitHash: string; at: string; }
export interface Release {
  id: string;
  flagId: string;
  version: string;        // 带版本号的候选发布，如 v1.2.0
  commitHash: string;     // 本次提交的哈希，审批只认可这一次提交的内容
  rules: RuleSet;         // 提交时的规则快照（不可变）
  rollout: number;        // 提交时的放量比例快照（不可变）
  status: ReleaseStatus;  // pending 等待生效 / live 正在生效 / obsolete 已经作废
  approvals: Approval[];
  dependencies: string[]; // 生效前必须仍启用的依赖开关 key
  scheduledAt: string;    // 定时生效时间
  effectiveAt: string;    // 实际生效时间
  createdAt: string;
  note: string;
  failureReason: string;  // 最近一次切换失败原因
  obsoleteReason: string; // superseded 被后续提交取代 / rolled-back 回滚作废
}
export interface FeatureFlag {
  id: string;
  name: string;
  key: string;
  enabled: boolean;       // 主开关（紧急停止立即关闭）
  stopped: boolean;       // 紧急停止状态：期间定时切换一律暂停
  draft: { rules: RuleSet; rollout: number };
  dependencies: string[]; // 候选发布默认继承的依赖开关
}
export interface AuditRecord { id: string; at: string; actor: string; action: string; detail: string; }
interface State { flags: FeatureFlag[]; releases: Release[]; auditLogs: AuditRecord[]; activeId: string; }

export const ROLES = ['产品负责人', '研发负责人'];
const STORAGE_KEY = 'yf58-release-state';

const HEX = '0123456789abcdef';
function genCommitHash(): string {
  let s = '';
  for (let i = 0; i < 7; i++) s += HEX[Math.floor(Math.random() * 16)];
  return s;
}
function parseVersion(v: string): [number, number, number] {
  const parts = v.replace(/^v/i, '').split('.');
  return [0, 1, 2].map((i) => Number(parts[i] || 0)) as [number, number, number];
}
function nextVersionOf(flagId: string, releases: Release[]): string {
  let max: [number, number, number] | null = null;
  for (const r of releases) {
    if (r.flagId !== flagId) continue;
    const v = parseVersion(r.version);
    if (!max || v[0] > max[0] || (v[0] === max[0] && v[1] > max[1]) || (v[0] === max[0] && v[1] === max[1] && v[2] > max[2])) max = v;
  }
  if (!max) return 'v1.0.0';
  return `v${max[0]}.${max[1] + 1}.0`;
}

const inMinutes = (m: number) => { const d = new Date(Date.now() + m * 60000); return d.toISOString().slice(0, 16); };
const past = (days: number, h: number) => { const d = new Date(Date.now() - days * 86400000); d.setHours(h, 0, 0, 0); return d.toISOString(); };

const seed: State = {
  activeId: 'f1',
  flags: [
    { id: 'f1', name: '新版结算页', key: 'checkout-v2', enabled: true, stopped: false,
      draft: { rules: { region: '上海', appVersion: '>= 8.2', authenticated: true }, rollout: 10 },
      dependencies: ['payment-v3'] },
    { id: 'f2', name: '推荐模型 B', key: 'recommend-model-b', enabled: true, stopped: false,
      draft: { rules: { region: '全部', appVersion: '>= 8.0', authenticated: false }, rollout: 35 },
      dependencies: [] },
    { id: 'f3', name: '支付依赖开关', key: 'payment-v3', enabled: true, stopped: false,
      draft: { rules: { region: '全部', appVersion: '>= 8.0', authenticated: false }, rollout: 100 },
      dependencies: [] },
  ],
  releases: [
    { id: 'r1', flagId: 'f1', version: 'v1.0.0', commitHash: 'a1b2c3d',
      rules: { region: '上海', appVersion: '>= 8.2', authenticated: true }, rollout: 10,
      status: 'live',
      approvals: [
        { role: '产品负责人', commitHash: 'a1b2c3d', at: past(2, 9) },
        { role: '研发负责人', commitHash: 'a1b2c3d', at: past(2, 9) },
      ],
      dependencies: [], scheduledAt: '', effectiveAt: past(2, 10), createdAt: past(3, 9), note: '首发版本',
      failureReason: '', obsoleteReason: '' },
    { id: 'r2', flagId: 'f1', version: 'v1.1.0', commitHash: 'e4f5a6b',
      rules: { region: '上海', appVersion: '>= 8.2', authenticated: true }, rollout: 30,
      status: 'pending',
      approvals: [
        { role: '产品负责人', commitHash: 'e4f5a6b', at: past(0, 9) },
        { role: '研发负责人', commitHash: 'e4f5a6b', at: past(0, 9) },
      ],
      dependencies: ['payment-v3'], scheduledAt: inMinutes(10), effectiveAt: '', createdAt: past(1, 16), note: '放量提升至 30%',
      failureReason: '', obsoleteReason: '' },
    { id: 'r3', flagId: 'f2', version: 'v1.0.0', commitHash: '11aa22b',
      rules: { region: '全部', appVersion: '>= 8.0', authenticated: false }, rollout: 10,
      status: 'obsolete', approvals: [], dependencies: [], scheduledAt: '', effectiveAt: past(14, 10), createdAt: past(15, 10), note: '',
      failureReason: '', obsoleteReason: 'superseded' },
    { id: 'r4', flagId: 'f2', version: 'v1.1.0', commitHash: '33cc44d',
      rules: { region: '全部', appVersion: '>= 8.0', authenticated: false }, rollout: 35,
      status: 'live',
      approvals: [
        { role: '产品负责人', commitHash: '33cc44d', at: past(7, 9) },
        { role: '研发负责人', commitHash: '33cc44d', at: past(7, 9) },
      ],
      dependencies: [], scheduledAt: '', effectiveAt: past(7, 10), createdAt: past(8, 10), note: '',
      failureReason: '', obsoleteReason: '' },
    { id: 'r5', flagId: 'f2', version: 'v1.2.0', commitHash: '55ee66f',
      rules: { region: '全部', appVersion: '>= 8.5', authenticated: false }, rollout: 60,
      status: 'pending',
      approvals: [
        { role: '产品负责人', commitHash: '55ee66f', at: past(0, 11) },
      ],
      dependencies: [], scheduledAt: inMinutes(2 * 24 * 60), effectiveAt: '', createdAt: past(0, 10), note: '客户端版本门槛提升',
      failureReason: '', obsoleteReason: '' },
    { id: 'r6', flagId: 'f3', version: 'v1.0.0', commitHash: '77aa88b',
      rules: { region: '全部', appVersion: '>= 8.0', authenticated: false }, rollout: 100,
      status: 'live',
      approvals: [
        { role: '产品负责人', commitHash: '77aa88b', at: past(20, 9) },
        { role: '研发负责人', commitHash: '77aa88b', at: past(20, 9) },
      ],
      dependencies: [], scheduledAt: '', effectiveAt: past(20, 10), createdAt: past(21, 10), note: '',
      failureReason: '', obsoleteReason: '' },
  ],
  auditLogs: [
    { id: 'a1', at: '09:10:00', actor: '产品负责人', action: '创建开关', detail: 'checkout-v2 发布线建立' },
    { id: 'a2', at: '09:22:00', actor: '研发负责人', action: '提交候选发布', detail: 'checkout-v2 v1.0.0（提交 a1b2c3d）' },
  ],
};

function load(): State {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { return JSON.parse(saved) as State; } catch { /* 损坏则回退到种子数据 */ }
  }
  return structuredClone(seed);
}

export const useFlagStore = defineStore('flags', {
  state: () => load(),
  getters: {
    active(state): FeatureFlag | undefined { return state.flags.find((f) => f.id === state.activeId); },
    activeLiveRelease(state): Release | undefined {
      return state.releases.find((r) => r.flagId === state.activeId && r.status === 'live');
    },
    activeReleases(state): Release[] {
      return state.releases
        .filter((r) => r.flagId === state.activeId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  },
  actions: {
    persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.$state)); },
    audit(action: string, detail: string, actor = '当前操作人') {
      this.auditLogs.unshift({ id: `a-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, at: new Date().toLocaleTimeString('zh-CN', { hour12: false }), actor, action, detail });
      this.persist();
    },
    select(id: string) { this.activeId = id; this.persist(); },

    createFlag(name: string, key: string) {
      const id = `f-${Date.now()}`;
      this.flags.push({
        id, name, key, enabled: false, stopped: false,
        draft: { rules: { region: '全部', appVersion: '>= 1.0', authenticated: false }, rollout: 0 },
        dependencies: [],
      });
      this.activeId = id;
      this.audit('创建开关', `${key} 发布线已建立，草稿从 v0.0.0 开始，提交候选发布后才会生效`);
    },

    updateRule(rule: Partial<RuleSet>) {
      if (!this.active) return;
      this.active.draft.rules = { ...this.active.draft.rules, ...rule };
      this.audit('修改规则', `${this.active.key} 草稿：${JSON.stringify(this.active.draft.rules)}（需提交候选发布才生效）`);
    },
    setRollout(value: number) {
      if (!this.active) return;
      this.active.draft.rollout = value;
      this.audit('调整放量', `${this.active.key} 草稿放量 → ${value}%（需提交候选发布才生效）`);
    },
    setDependencies(keys: string[]) {
      if (!this.active) return;
      this.active.dependencies = keys;
      this.audit('设置依赖开关', `${this.active.key} 候选发布依赖：${keys.length ? keys.join('、') : '无'}`);
    },

    nextVersion(): string {
      if (!this.active) return 'v1.0.0';
      return nextVersionOf(this.active.id, this.releases);
    },

    // 提交候选发布：生成带版本号和提交哈希的不可变快照；旧的等待生效候选自动作废
    commitCandidate(note = '') {
      if (!this.active) return;
      const flag = this.active;
      const version = nextVersionOf(flag.id, this.releases);
      // 新提交取代所有等待生效的旧候选（审批只认可这一次提交的内容）
      for (const r of this.releases) {
        if (r.flagId === flag.id && r.status === 'pending') {
          r.status = 'obsolete';
          r.obsoleteReason = 'superseded';
        }
      }
      const release: Release = {
        id: `r-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
        flagId: flag.id,
        version,
        commitHash: genCommitHash(),
        rules: { ...flag.draft.rules },
        rollout: flag.draft.rollout,
        status: 'pending',
        approvals: [],
        dependencies: [...flag.dependencies],
        scheduledAt: '',
        effectiveAt: '',
        createdAt: new Date().toISOString(),
        note,
        failureReason: '',
        obsoleteReason: '',
      };
      this.releases.push(release);
      this.audit('提交候选发布', `${flag.key} ${version}（提交 ${release.commitHash}）已提交，等待审批`);
    },

    approveRelease(releaseId: string, role: string) {
      const r = this.releases.find((x) => x.id === releaseId);
      if (!r || r.status !== 'pending') return;
      if (r.approvals.some((a) => a.role === role)) return;
      r.approvals.push({ role, commitHash: r.commitHash, at: new Date().toISOString() });
      const flag = this.flags.find((f) => f.id === r.flagId);
      this.audit('审批发布', `${role} 已审批 ${flag?.key ?? ''} ${r.version}（绑定提交 ${r.commitHash}）`, role);
    },

    scheduleRelease(releaseId: string, at: string) {
      const r = this.releases.find((x) => x.id === releaseId);
      if (!r || r.status !== 'pending') return;
      r.scheduledAt = at;
      const flag = this.flags.find((f) => f.id === r.flagId);
      this.audit('设置定时生效', `${flag?.key ?? ''} ${r.version} 定于 ${at} 自动生效`);
    },

    voidRelease(releaseId: string) {
      const r = this.releases.find((x) => x.id === releaseId);
      if (!r || r.status !== 'pending') return;
      r.status = 'obsolete';
      r.obsoleteReason = 'superseded';
      const flag = this.flags.find((f) => f.id === r.flagId);
      this.audit('作废候选发布', `${flag?.key ?? ''} ${r.version} 已手动作废`);
    },

    // 生效前核对：依赖开关仍启用 + 审批未因后续改动失效
    preflight(r: Release): { ok: boolean; reasons: string[] } {
      const flag = this.flags.find((f) => f.id === r.flagId);
      const reasons: string[] = [];
      if (!flag) { return { ok: false, reasons: ['开关不存在'] }; }
      if (r.status !== 'pending') reasons.push('发布已结束');
      if (flag.stopped) reasons.push('开关处于紧急停止状态，禁止自动切换');
      for (const role of ROLES) {
        const a = r.approvals.find((x) => x.role === role);
        if (!a) reasons.push(`缺少${role}审批`);
        else if (a.commitHash !== r.commitHash) reasons.push(`${role}审批绑定的提交已失效`);
      }
      for (const depKey of r.dependencies) {
        const dep = this.flags.find((f) => f.key === depKey);
        if (!dep) reasons.push(`依赖开关 ${depKey} 不存在`);
        else if (dep.stopped || !dep.enabled) reasons.push(`依赖开关 ${depKey} 未启用`);
      }
      return { ok: reasons.length === 0, reasons };
    },

    // 一次性切换：核对通过才生效；失败则恢复原生效版本，本次发布留待处理
    activateRelease(releaseId: string): { ok: boolean; reasons: string[] } {
      const r = this.releases.find((x) => x.id === releaseId);
      if (!r) return { ok: false, reasons: ['发布不存在'] };
      const flag = this.flags.find((f) => f.id === r.flagId);
      if (!flag) return { ok: false, reasons: ['开关不存在'] };

      const { ok, reasons } = this.preflight(r);
      if (!ok) {
        r.failureReason = reasons.join('；');
        this.audit('切换失败', `${flag.key} ${r.version} 生效前核对未通过：${r.failureReason}。保持原版本生效，本次发布留待处理`);
        return { ok: false, reasons };
      }

      // 原子切换：原生效版本作废 → 新版本生效并记录生效时间
      const prevLive = this.releases.find((x) => x.flagId === flag.id && x.status === 'live');
      if (prevLive) {
        prevLive.status = 'obsolete';
        prevLive.obsoleteReason = 'superseded';
      }
      r.status = 'live';
      r.effectiveAt = new Date().toISOString();
      r.failureReason = '';
      flag.enabled = true;
      flag.stopped = false;
      flag.draft = { rules: { ...r.rules }, rollout: r.rollout };
      this.audit('发布生效', `${flag.key} ${r.version} 已一次性切换：规则 ${JSON.stringify(r.rules)}，放量 ${r.rollout}%，生效时间 ${new Date(r.effectiveAt).toLocaleString('zh-CN', { hour12: false })}`);
      return { ok: true, reasons: [] };
    },

    // 定时扫描：到点且未被紧急停止暂停的候选自动生效
    tick() {
      const now = Date.now();
      for (const r of this.releases) {
        if (r.status !== 'pending' || !r.scheduledAt) continue;
        const t = new Date(r.scheduledAt).getTime();
        if (Number.isNaN(t) || t > now) continue;
        const flag = this.flags.find((f) => f.id === r.flagId);
        if (flag?.stopped) continue; // 紧急停止期间不自动切换，避免与停止动作相撞
        this.activateRelease(r.id);
      }
    },

    emergencyStop() {
      if (!this.active) return;
      this.active.enabled = false;
      this.active.stopped = true;
      this.audit('紧急停止', `${this.active.key} 已立即关闭，所有定时发布暂停自动切换`);
    },
    resume() {
      if (!this.active) return;
      this.active.enabled = true;
      this.active.stopped = false;
      this.audit('恢复开关', `${this.active.key} 已恢复启用，定时发布将按计划继续`);
    },
    rollback() {
      if (!this.active) return;
      const flag = this.active;
      const current = this.releases.find((x) => x.flagId === flag.id && x.status === 'live');
      const prev = this.releases
        .filter((x) => x.flagId === flag.id && x.status === 'obsolete' && x.obsoleteReason === 'superseded' && x.effectiveAt)
        .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))[0];
      if (current) {
        current.status = 'obsolete';
        current.obsoleteReason = 'rolled-back';
      }
      if (prev) {
        prev.status = 'live';
        prev.obsoleteReason = '';
        prev.effectiveAt = new Date().toISOString();
        flag.draft = { rules: { ...prev.rules }, rollout: prev.rollout };
      }
      flag.enabled = true;
      flag.stopped = false;
      this.audit('执行回滚', `${flag.key} 已回滚至 ${prev?.version ?? '关闭状态'}，生效版本保持连续`);
    },

    simulateHit(user: { region: string; appVersion: string; authenticated: boolean; id: string }) {
      const flag = this.active;
      if (!flag) return { hit: false, reason: '未选择开关' };
      if (flag.stopped || !flag.enabled) return { hit: false, reason: '开关未启用' };
      const live = this.activeLiveRelease;
      if (!live) return { hit: false, reason: '暂无生效版本' };
      const rule = live.rules;
      if (rule.region !== '全部' && rule.region !== user.region) return { hit: false, reason: `地区不匹配（要求${rule.region}）` };
      if (rule.authenticated && !user.authenticated) return { hit: false, reason: '要求已登录用户' };
      const hash = [...user.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 100;
      const hit = hash < live.rollout;
      return { hit, reason: hit ? `灰度桶 ${hash} < ${live.rollout}%（${live.version}）` : `灰度桶 ${hash} ≥ ${live.rollout}%（${live.version}）` };
    },
  },
});
