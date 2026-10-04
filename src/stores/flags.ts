import { defineStore } from 'pinia';

export interface RuleSet { region: string; appVersion: string; authenticated: boolean; }
export type ReleaseStatus = 'pending' | 'effective' | 'voided';
export interface Release {
  id: string;
  flagId: string;
  version: number;
  rules: RuleSet;
  rollout: number;
  hash: string;
  status: ReleaseStatus;
  approvals: string[];
  submittedAt: string;
  scheduledAt: string;
  effectiveAt?: string;
  voidedAt?: string;
  voidReason?: string;
  failureReason?: string;
  lastAttemptAt?: string;
}
export interface FeatureFlag {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  dependsOn: string[];
  draftRules: RuleSet;
  draftRollout: number;
}
export interface AuditRecord { id: string; at: string; actor: string; action: string; detail: string; }

interface State { flags: FeatureFlag[]; releases: Release[]; audit: AuditRecord[]; activeId: string; }

export const REQUIRED_ROLES = ['产品负责人', '研发负责人'];
const STORAGE_KEY = 'yf58-release-line';

const iso = () => new Date().toISOString();
const cloneRules = (rules: RuleSet): RuleSet => ({ ...rules });

export function hashOf(rules: RuleSet, rollout: number): string {
  const text = JSON.stringify({ rules, rollout });
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

function buildSeed(): State {
  const checkoutRules: RuleSet = { region: '上海', appVersion: '>= 8.2', authenticated: true };
  const recommendRules: RuleSet = { region: '全部', appVersion: '>= 8.0', authenticated: false };
  const paymentRules: RuleSet = { region: '全部', appVersion: '>= 7.0', authenticated: true };
  return {
    activeId: 'f1',
    flags: [
      { id: 'f1', name: '新版结算页', key: 'checkout-v2', enabled: false, dependsOn: ['f3'], draftRules: cloneRules(checkoutRules), draftRollout: 10 },
      { id: 'f2', name: '推荐模型 B', key: 'recommend-model-b', enabled: true, dependsOn: [], draftRules: cloneRules(recommendRules), draftRollout: 35 },
      { id: 'f3', name: '支付通道 v3', key: 'payment-v3', enabled: true, dependsOn: [], draftRules: cloneRules(paymentRules), draftRollout: 100 }
    ],
    releases: [
      { id: 'r1', flagId: 'f1', version: 1, rules: { region: '全部', appVersion: '>= 8.0', authenticated: false }, rollout: 5, hash: hashOf({ region: '全部', appVersion: '>= 8.0', authenticated: false }, 5), status: 'voided', approvals: ['产品负责人', '研发负责人'], submittedAt: '2026-10-03T09:10:00.000Z', scheduledAt: '2026-10-03T18:00', voidedAt: '2026-10-03T10:02:00.000Z', voidReason: '被 v2 取代' },
      { id: 'r2', flagId: 'f1', version: 2, rules: { region: '上海', appVersion: '>= 8.0', authenticated: true }, rollout: 5, hash: hashOf({ region: '上海', appVersion: '>= 8.0', authenticated: true }, 5), status: 'voided', approvals: ['产品负责人'], submittedAt: '2026-10-03T10:02:00.000Z', scheduledAt: '2026-10-04T09:00', voidedAt: '2026-10-04T08:30:00.000Z', voidReason: '被 v3 取代，原审批随之失效' },
      { id: 'r3', flagId: 'f1', version: 3, rules: cloneRules(checkoutRules), rollout: 10, hash: hashOf(checkoutRules, 10), status: 'pending', approvals: ['产品负责人'], submittedAt: '2026-10-04T08:30:00.000Z', scheduledAt: '2026-10-04T23:59' },
      { id: 'r4', flagId: 'f2', version: 1, rules: cloneRules(recommendRules), rollout: 35, hash: hashOf(recommendRules, 35), status: 'effective', approvals: ['产品负责人', '研发负责人'], submittedAt: '2026-10-02T14:00:00.000Z', scheduledAt: '2026-10-02T20:00', effectiveAt: '2026-10-02T12:00:00.000Z' },
      { id: 'r5', flagId: 'f3', version: 1, rules: cloneRules(paymentRules), rollout: 100, hash: hashOf(paymentRules, 100), status: 'effective', approvals: ['产品负责人', '研发负责人'], submittedAt: '2026-10-01T09:00:00.000Z', scheduledAt: '2026-10-01T12:00', effectiveAt: '2026-10-01T04:00:00.000Z' }
    ],
    audit: [
      { id: 'a1', at: '2026-10-04T08:30:00.000Z', actor: '产品负责人', action: '提交候选发布', detail: 'checkout-v2 v3（哈希 ' + hashOf(checkoutRules, 10) + '），v2 作废、审批需重新进行' },
      { id: 'a2', at: '2026-10-04T08:31:00.000Z', actor: '产品负责人', action: '审批发布', detail: 'checkout-v2 v3 产品审批通过，仅认可本次提交内容' },
      { id: 'a3', at: '2026-10-04T08:32:00.000Z', actor: '值班员', action: '设置定时', detail: 'checkout-v2 v3 定于 2026-10-04T23:59 切换' }
    ]
  };
}

function load(): State {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) as State : buildSeed();
}

export const useFlagStore = defineStore('flags', {
  state: () => load(),
  getters: {
    active(state): FeatureFlag | undefined { return state.flags.find((item) => item.id === state.activeId); },
    releasesOf(state): (flagId: string) => Release[] {
      return (flagId) => state.releases.filter((item) => item.flagId === flagId).sort((a, b) => b.version - a.version);
    },
    effectiveOf(state): (flagId: string) => Release | undefined {
      return (flagId) => state.releases.find((item) => item.flagId === flagId && item.status === 'effective');
    },
    previousEffectiveOf(state): (flagId: string) => Release | undefined {
      return (flagId) => state.releases
        .filter((item) => item.flagId === flagId && item.status === 'voided' && item.effectiveAt)
        .sort((a, b) => b.version - a.version)[0];
    }
  },
  actions: {
    persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.$state)); },
    record(action: string, detail: string, actor = '值班员') {
      this.audit.unshift({ id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: iso(), actor, action, detail });
      this.persist();
    },
    select(id: string) { this.activeId = id; this.persist(); },
    flagById(id: string) { return this.flags.find((item) => item.id === id); },
    releaseById(id: string) { return this.releases.find((item) => item.id === id); },
    approvalComplete(release: Release) { return REQUIRED_ROLES.every((role) => release.approvals.includes(role)); },

    updateDraftRule(rule: Partial<RuleSet>) {
      if (!this.active) return;
      this.active.draftRules = { ...this.active.draftRules, ...rule };
      this.record('修改草稿规则', `${this.active.key} 草稿调整为 ${JSON.stringify(this.active.draftRules)}（提交后生成新版本）`);
    },
    setDraftRollout(value: number) {
      if (!this.active) return;
      this.active.draftRollout = value;
      this.record('调整草稿放量', `${this.active.key} 草稿放量 → ${value}%`);
    },
    setDependsOn(ids: string[]) {
      if (!this.active) return;
      this.active.dependsOn = ids;
      const names = ids.map((id) => this.flagById(id)?.key ?? id).join('、') || '无';
      this.record('修改依赖开关', `${this.active.key} 依赖 ${names}`);
    },

    submitRelease() {
      const flag = this.active;
      if (!flag) return;
      const version = Math.max(0, ...this.releases.filter((item) => item.flagId === flag.id).map((item) => item.version)) + 1;
      const now = iso();
      for (const stale of this.releases.filter((item) => item.flagId === flag.id && item.status === 'pending')) {
        stale.status = 'voided';
        stale.voidedAt = now;
        stale.voidReason = `被新提交 v${version} 取代，原审批随之失效`;
      }
      const release: Release = {
        id: `r-${Date.now()}`,
        flagId: flag.id,
        version,
        rules: cloneRules(flag.draftRules),
        rollout: flag.draftRollout,
        hash: hashOf(flag.draftRules, flag.draftRollout),
        status: 'pending',
        approvals: [],
        submittedAt: now,
        scheduledAt: ''
      };
      this.releases.push(release);
      this.record('提交候选发布', `${flag.key} v${version}（哈希 ${release.hash}，放量 ${release.rollout}%）进入等待生效，需重新完成双审批`);
    },

    approveRelease(releaseId: string, role: string) {
      const release = this.releaseById(releaseId);
      const flag = release && this.flagById(release.flagId);
      if (!release || !flag || release.status !== 'pending' || release.approvals.includes(role)) return;
      release.approvals.push(role);
      this.record('审批发布', `${flag.key} v${release.version}（哈希 ${release.hash}）${role}审批通过，仅认可本次提交内容`, role);
    },

    scheduleRelease(releaseId: string, value: string) {
      const release = this.releaseById(releaseId);
      const flag = release && this.flagById(release.flagId);
      if (!release || !flag || release.status !== 'pending' || !value) return;
      release.scheduledAt = value;
      release.lastAttemptAt = undefined;
      release.failureReason = undefined;
      this.record('设置定时', `${flag.key} v${release.version} 定于 ${value} 切换，到点自动核对依赖与审批`);
    },

    voidRelease(releaseId: string, reason: string) {
      const release = this.releaseById(releaseId);
      const flag = release && this.flagById(release.flagId);
      if (!release || !flag || release.status !== 'pending') return;
      release.status = 'voided';
      release.voidedAt = iso();
      release.voidReason = reason;
      this.record('作废发布', `${flag.key} v${release.version} 作废：${reason}`);
    },

    attemptRelease(releaseId: string, trigger: '定时' | '手动') {
      const release = this.releaseById(releaseId);
      if (!release || release.status !== 'pending') return;
      const flag = this.flagById(release.flagId);
      if (!flag) return;
      const now = iso();
      release.lastAttemptAt = now;
      const current = this.effectiveOf(release.flagId);
      const keep = current ? `v${current.version}` : '原关闭状态';

      if (!this.approvalComplete(release)) {
        release.failureReason = '审批未完成或已因后续改动失效';
        this.record('切换失败', `${flag.key} v${release.version}（${trigger}）审批未完成或已失效，保持 ${keep} 生效，本次发布留作待处理`);
        return;
      }
      const missing = flag.dependsOn.map((id) => this.flagById(id)).filter((item) => !item || !item.enabled);
      if (missing.length > 0) {
        release.failureReason = `依赖开关未启用：${missing.map((item) => item?.key ?? '未知').join('、')}`;
        this.record('切换失败', `${flag.key} v${release.version}（${trigger}）${release.failureReason}，保持 ${keep} 生效，本次发布留作待处理`);
        return;
      }

      if (current) {
        current.status = 'voided';
        current.voidedAt = now;
        current.voidReason = `被 v${release.version} 取代`;
      }
      release.status = 'effective';
      release.effectiveAt = now;
      release.failureReason = undefined;
      flag.enabled = true;
      flag.draftRules = cloneRules(release.rules);
      flag.draftRollout = release.rollout;
      this.record('切换生效', `${flag.key} v${release.version}（${trigger}）于 ${now} 一次性切换新规则与 ${release.rollout}% 放量${current ? `，原 v${current.version} 作废` : ''}`);
    },

    tick() {
      const now = Date.now();
      const due = this.releases
        .filter((item) => item.status === 'pending' && item.scheduledAt && !item.lastAttemptAt && new Date(item.scheduledAt).getTime() <= now)
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
      for (const release of due) this.attemptRelease(release.id, '定时');
    },

    emergencyStop(flagId: string) {
      const flag = this.flagById(flagId);
      if (!flag) return;
      const now = iso();
      flag.enabled = false;
      let cancelled = 0;
      for (const release of this.releases.filter((item) => item.flagId === flagId)) {
        if (release.status === 'effective') { release.status = 'voided'; release.voidedAt = now; release.voidReason = '紧急停止'; }
        if (release.status === 'pending') { release.status = 'voided'; release.voidedAt = now; release.voidReason = '紧急停止，取消待生效发布'; cancelled += 1; }
      }
      this.record('紧急停止', `${flag.key} 已立即关闭${cancelled ? `，同时作废 ${cancelled} 个待生效发布，避免与定时切换冲突` : ''}`);
    },

    rollback(flagId: string) {
      const flag = this.flagById(flagId);
      if (!flag) return;
      const now = iso();
      const current = this.effectiveOf(flagId);
      const previous = this.previousEffectiveOf(flagId);
      if (current) {
        current.status = 'voided';
        current.voidedAt = now;
        current.voidReason = previous ? `回滚至 v${previous.version}` : '回滚，无历史版本可恢复';
      }
      if (previous) {
        previous.status = 'effective';
        previous.effectiveAt = now;
        previous.voidedAt = undefined;
        previous.voidReason = undefined;
        flag.enabled = true;
        flag.draftRules = cloneRules(previous.rules);
        flag.draftRollout = previous.rollout;
        this.record('执行回滚', `${flag.key} 恢复至 v${previous.version}（放量 ${previous.rollout}%）`);
      } else {
        flag.enabled = false;
        this.record('执行回滚', `${flag.key} 无历史生效版本，已关闭`);
      }
    },

    createFlag(name: string, key: string) {
      const id = `f-${Date.now()}`;
      this.flags.push({ id, name, key, enabled: false, dependsOn: [], draftRules: { region: '全部', appVersion: '>= 1.0', authenticated: false }, draftRollout: 0 });
      this.select(id);
      this.record('创建开关', `${key} 草稿就绪，提交后生成 v1 候选发布`);
    },

    simulateHit(user: { region: string; appVersion: string; authenticated: boolean; id: string }) {
      const flag = this.active;
      if (!flag) return { hit: false, reason: '未选择开关' };
      const live = this.effectiveOf(flag.id);
      if (!flag.enabled || !live) return { hit: false, reason: '开关未启用（无正在生效的版本）' };
      const rule = live.rules;
      if (rule.region !== '全部' && rule.region !== user.region) return { hit: false, reason: `地区不匹配（v${live.version} 要求${rule.region}）` };
      if (rule.authenticated && !user.authenticated) return { hit: false, reason: `v${live.version} 要求已登录用户` };
      const hash = [...user.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 100;
      const hit = hash < live.rollout;
      return { hit, reason: hit ? `命中 v${live.version}：灰度桶 ${hash} < ${live.rollout}%` : `未命中 v${live.version}：灰度桶 ${hash} ≥ ${live.rollout}%` };
    }
  }
});
