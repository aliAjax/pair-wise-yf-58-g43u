<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useOnline } from '@vueuse/core';
import { toTypedSchema } from '@vee-validate/zod';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import { useFlagStore, ROLES } from './stores/flags';
import type { FeatureFlag, Release, ReleaseStatus } from './stores/flags';

const store = useFlagStore();
const online = useOnline();
const active = computed(() => store.active);
const liveRelease = computed(() => store.activeLiveRelease);
const releases = computed(() => store.activeReleases);
const nextVersion = computed(() => store.nextVersion());

const now = ref(Date.now());
let timer: number | undefined;
onMounted(() => {
  timer = window.setInterval(() => {
    now.value = Date.now();
    store.tick();
  }, 1000);
});
onUnmounted(() => { if (timer) window.clearInterval(timer); });

const createOpen = ref(false);
const simulation = ref<{ hit: boolean; reason: string } | null>(null);
const user = reactive({ id: 'user-1042', region: '上海', appVersion: '8.3.0', authenticated: true });
const schema = toTypedSchema(z.object({
  name: z.string().min(3, '名称至少 3 个字符'),
  key: z.string().regex(/^[a-z0-9-]+$/, '仅支持小写字母、数字和连字符'),
}));
const { defineField, errors, handleSubmit, resetForm } = useForm({ validationSchema: schema });
const [name] = defineField('name');
const [key] = defineField('key');
const create = handleSubmit((values) => {
  store.createFlag(values.name, values.key);
  createOpen.value = false;
  resetForm();
});
function simulate() { if (active.value) simulation.value = store.simulateHit(user); }

const STATUS_META: Record<ReleaseStatus, { text: string; color: string }> = {
  live: { text: '正在生效', color: 'green' },
  pending: { text: '等待生效', color: 'gold' },
  obsolete: { text: '已经作废', color: 'default' },
};
function statusMeta(s: ReleaseStatus) { return STATUS_META[s]; }
function obsoleteReasonText(r: Release) {
  return r.obsoleteReason === 'rolled-back' ? '回滚作废' : '已被后续提交取代';
}
function formatTime(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}
function countdown(iso: string) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now.value;
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return '到点，等待执行';
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d} 天 ${h} 时后生效`;
  if (h > 0) return `${h} 时 ${m} 分后生效`;
  return `${m} 分 ${s} 秒后生效`;
}
function depFlag(depKey: string): FeatureFlag | undefined {
  return store.flags.find((f) => f.key === depKey);
}
function depState(depKey: string) {
  const d = depFlag(depKey);
  if (!d) return { ok: false, label: '不存在' };
  if (d.stopped) return { ok: false, label: '紧急停止' };
  if (!d.enabled) return { ok: false, label: '已关闭' };
  return { ok: true, label: '已启用' };
}
function approvalState(r: Release, role: string): 'ok' | 'stale' | 'none' {
  const a = r.approvals.find((x) => x.role === role);
  if (!a) return 'none';
  return a.commitHash === r.commitHash ? 'ok' : 'stale';
}
function ruleText(r: Release) {
  return `${r.rules.region} · ${r.rules.appVersion} · ${r.rules.authenticated ? '需登录' : '不限登录'}`;
}
function activate(r: Release) {
  const result = store.activateRelease(r.id);
  if (!result.ok) simulation.value = null;
}
</script>

<template>
  <a-config-provider>
    <a-layout class="app-shell">
      <a-layout-header class="topbar">
        <div>
          <div class="eyebrow">FEATURE FLAG / RELEASE CONSOLE</div>
          <h1>{{ $t('title') }}</h1>
          <div class="subtitle">功能开关 · 候选发布 · 依赖核对 · 审计记录 受控发布线</div>
        </div>
        <a-space>
          <a-tag :color="online ? 'green' : 'orange'">{{ online ? '控制面在线' : '离线草稿' }}</a-tag>
          <a-button type="primary" @click="createOpen = true">新建功能开关</a-button>
        </a-space>
      </a-layout-header>
      <a-layout-content class="content">
        <a-alert v-if="!online" type="warning" show-icon message="离线状态" description="规则修改保留在浏览器，恢复网络后仍需完成审批才能发布。" class="mb" />
        <a-row :gutter="[18, 18]">
          <a-col :xs="24" :lg="7">
            <a-card title="功能开关" size="small">
              <a-list :data-source="store.flags" bordered>
                <template #renderItem="{ item }">
                  <a-list-item :class="{ selected: item.id === store.activeId }" @click="store.select(item.id)">
                    <a-list-item-meta>
                      <template #title>
                        <a-space>
                          <span>{{ item.name }}</span>
                          <a-tag v-if="item.stopped" color="red">已停止</a-tag>
                          <a-tag v-else color="green">生效中</a-tag>
                        </a-space>
                      </template>
                      <template #description>
                        <code>{{ item.key }}</code>
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>
            </a-card>
            <a-card title="规则命中模拟（按正在生效版本）" size="small" class="mt">
              <a-form layout="vertical">
                <a-form-item label="用户 ID"><a-input v-model:value="user.id" /></a-form-item>
                <a-row :gutter="8">
                  <a-col :span="12"><a-form-item label="地区"><a-input v-model:value="user.region" /></a-form-item></a-col>
                  <a-col :span="12"><a-form-item label="版本"><a-input v-model:value="user.appVersion" /></a-form-item></a-col>
                </a-row>
                <a-checkbox v-model:checked="user.authenticated">已登录</a-checkbox>
                <a-button type="primary" block class="mt" @click="simulate">{{ $t('simulate') }}</a-button>
              </a-form>
              <a-alert v-if="simulation" class="mt" :type="simulation.hit ? 'success' : 'info'" show-icon :message="simulation.hit ? '命中新功能' : '未命中'" :description="simulation.reason" />
            </a-card>
          </a-col>

          <a-col :xs="24" :lg="17">
            <template v-if="active">
              <a-card class="mb">
                <template #title>
                  <a-space>
                    <span>{{ active.name }}</span>
                    <a-tag v-if="active.stopped" color="red">紧急停止中</a-tag>
                    <a-tag v-else-if="liveRelease" color="green">正在生效 {{ liveRelease.version }}</a-tag>
                    <a-tag v-else color="default">暂无生效版本</a-tag>
                  </a-space>
                </template>
                <template #extra>
                  <a-space>
                    <a-button v-if="active.stopped" type="primary" ghost @click="store.resume">恢复开关</a-button>
                    <a-button v-else danger @click="store.emergencyStop">紧急停止</a-button>
                    <a-button danger ghost :disabled="!liveRelease" @click="store.rollback">回滚上一版本</a-button>
                  </a-space>
                </template>
                <a-alert
                  v-if="active.stopped"
                  type="error"
                  show-icon
                  class="mb"
                  message="紧急停止已生效：定时自动切换暂停"
                  description="停止期间到点的候选发布不会切换，保持原生效版本不变；恢复开关后按计划继续。"
                />
                <a-descriptions bordered :column="{ xs: 1, md: 3 }">
                  <a-descriptions-item label="开关 Key"><code>{{ active.key }}</code></a-descriptions-item>
                  <a-descriptions-item label="当前生效放量">{{ liveRelease ? liveRelease.rollout + '%' : '—' }}</a-descriptions-item>
                  <a-descriptions-item label="生效时间">{{ liveRelease ? formatTime(liveRelease.effectiveAt) : '—' }}</a-descriptions-item>
                </a-descriptions>
              </a-card>

              <a-card title="草稿编辑（修改后需提交候选发布才生效）" size="small" class="mb">
                <a-form layout="vertical">
                  <a-row :gutter="16">
                    <a-col :span="8">
                      <a-form-item label="目标地区">
                        <a-select :value="active.draft.rules.region" :options="['全部', '上海', '北京', '广东'].map((v) => ({ value: v, label: v }))" @change="(v: string) => store.updateRule({ region: v })" />
                      </a-form-item>
                    </a-col>
                    <a-col :span="8">
                      <a-form-item label="客户端版本">
                        <a-input :value="active.draft.rules.appVersion" @change="(e: Event) => store.updateRule({ appVersion: (e.target as HTMLInputElement).value })" />
                      </a-form-item>
                    </a-col>
                    <a-col :span="8">
                      <a-form-item label="登录要求">
                        <a-switch :checked="active.draft.rules.authenticated" @change="(v: boolean) => store.updateRule({ authenticated: v })" />
                      </a-form-item>
                    </a-col>
                  </a-row>
                  <a-divider style="margin: 8px 0" />
                  <a-form-item label="草稿放量"><a-slider :value="active.draft.rollout" :min="0" :max="100" :step="5" @change="(v: number) => store.setRollout(v)" /></a-form-item>
                  <div class="rollout-label">{{ active.draft.rollout }}% 用户可命中</div>
                  <a-form-item label="依赖开关（生效前必须仍启用）" class="mt">
                    <a-select
                      mode="multiple"
                      :value="active.dependencies"
                      :options="store.flags.filter((f) => f.key !== active?.key).map((f) => ({ value: f.key, label: `${f.name}（${f.key}）` }))"
                      placeholder="选择本发布依赖的其他开关"
                      @change="(v: string[]) => store.setDependencies(v)"
                    />
                  </a-form-item>
                  <a-button type="primary" @click="store.commitCandidate()">提交候选发布 {{ nextVersion }}</a-button>
                </a-form>
              </a-card>

              <a-card title="发布版本（正在生效 / 等待生效 / 已经作废）" size="small" class="mb">
                <div v-for="r in releases" :key="r.id" class="release-card" :class="r.status">
                  <div class="release-head">
                    <a-space>
                      <a-tag :color="statusMeta(r.status).color">{{ statusMeta(r.status).text }}</a-tag>
                      <b class="release-version">{{ r.version }}</b>
                      <code class="commit-hash">{{ r.commitHash }}</code>
                    </a-space>
                    <a-space>
                      <span v-if="r.status === 'pending' && r.scheduledAt" class="countdown">{{ countdown(r.scheduledAt) }}</span>
                      <a-tag v-if="r.status === 'obsolete'" color="default">{{ obsoleteReasonText(r) }}</a-tag>
                    </a-space>
                  </div>
                  <div class="release-meta">
                    <div>规则：{{ ruleText(r) }}</div>
                    <div>放量：<b>{{ r.rollout }}%</b></div>
                    <div v-if="r.note">说明：{{ r.note }}</div>
                    <div>提交时间：{{ formatTime(r.createdAt) }}</div>
                    <div v-if="r.status === 'live'">生效时间：{{ formatTime(r.effectiveAt) }}</div>
                    <div v-if="r.scheduledAt && r.status === 'pending'">定时时间：{{ formatTime(r.scheduledAt) }}</div>
                  </div>

                  <div class="check-row">
                    <span class="check-label">生效前核对：</span>
                    <a-tag v-for="dep in r.dependencies" :key="dep" :color="depState(dep).ok ? 'green' : 'red'">
                      依赖 {{ dep }}：{{ depState(dep).label }}
                    </a-tag>
                    <a-tag v-if="!r.dependencies.length" color="green">无依赖</a-tag>
                    <a-tag v-for="role in ROLES" :key="role" :color="approvalState(r, role) === 'ok' ? 'green' : approvalState(r, role) === 'stale' ? 'red' : 'default'">
                      {{ role }}：{{ approvalState(r, role) === 'ok' ? '已审批且绑定本提交' : approvalState(r, role) === 'stale' ? '审批已失效' : '待审批' }}
                    </a-tag>
                  </div>

                  <a-alert
                    v-if="r.failureReason"
                    type="error"
                    show-icon
                    class="mt"
                    message="上次切换未执行，已恢复原生效版本，本发布留待处理"
                    :description="r.failureReason"
                  />

                  <div v-if="r.status === 'pending'" class="release-actions">
                    <a-space wrap>
                      <a-button size="small" :disabled="approvalState(r, '产品负责人') !== 'none'" @click="store.approveRelease(r.id, '产品负责人')">产品审批</a-button>
                      <a-button size="small" :disabled="approvalState(r, '研发负责人') !== 'none'" @click="store.approveRelease(r.id, '研发负责人')">研发审批</a-button>
                      <a-input
                        type="datetime-local"
                        size="small"
                        style="width: 200px"
                        :value="r.scheduledAt"
                        @change="(e: Event) => store.scheduleRelease(r.id, (e.target as HTMLInputElement).value)"
                      />
                      <a-button size="small" type="primary" @click="activate(r)">立即生效</a-button>
                      <a-button size="small" danger ghost @click="store.voidRelease(r.id)">作废</a-button>
                    </a-space>
                  </div>
                </div>
                <a-empty v-if="!releases.length" description="暂无候选发布，请在上方提交" />
              </a-card>

              <a-card title="审计记录" size="small">
                <a-timeline>
                  <a-timeline-item v-for="item in store.auditLogs" :key="item.id" :color="item.action.includes('失败') || item.action.includes('停止') || item.action.includes('回滚') ? 'red' : item.action.includes('生效') ? 'green' : 'blue'">
                    <b>{{ item.at }} · {{ item.actor }}</b>
                    <p>{{ item.action }}：{{ item.detail }}</p>
                  </a-timeline-item>
                </a-timeline>
              </a-card>
            </template>
          </a-col>
        </a-row>
      </a-layout-content>

      <a-modal v-model:open="createOpen" title="新建功能开关" @ok="create">
        <a-form layout="vertical">
          <a-form-item label="展示名称" :validate-status="errors.name ? 'error' : ''" :help="errors.name">
            <a-input v-model:value="name" />
          </a-form-item>
          <a-form-item label="开关 Key" :validate-status="errors.key ? 'error' : ''" :help="errors.key">
            <a-input v-model:value="key" />
          </a-form-item>
        </a-form>
      </a-modal>
    </a-layout>
  </a-config-provider>
</template>

<style>
* { box-sizing: border-box; }
body { margin: 0; background: #f4f6fb; font-family: Inter, "PingFang SC", sans-serif; }
.app-shell { min-height: 100vh; background: transparent; }
.topbar { height: auto; min-height: 88px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px 32px; color: white; background: linear-gradient(120deg, #111827, #312e81); }
.topbar h1 { color: white; margin: 3px 0; font-size: 25px; }
.subtitle { color: #c7d2fe; font-size: 12px; margin-top: 2px; }
.eyebrow { color: #a5b4fc; font-size: 11px; letter-spacing: .13em; }
.content { max-width: 1400px; width: 100%; margin: 0 auto; padding: 24px; }
.mb { margin-bottom: 18px; }
.mt { margin-top: 14px; }
.selected { background: #eef2ff; cursor: pointer; }
.rollout-label { color: #4338ca; font-weight: 700; }
.ant-list-item { cursor: pointer; }
.release-card { border: 1px solid #e5e7eb; border-left-width: 4px; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; background: #fff; }
.release-card.live { border-left-color: #16a34a; background: #f0fdf4; }
.release-card.pending { border-left-color: #d97706; background: #fffbeb; }
.release-card.obsolete { border-left-color: #d1d5db; background: #f9fafb; opacity: .85; }
.release-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.release-version { font-size: 15px; }
.commit-hash { background: #eef2ff; color: #4338ca; padding: 1px 8px; border-radius: 4px; font-size: 12px; }
.release-meta { margin: 8px 0; font-size: 13px; color: #374151; line-height: 1.9; }
.check-row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; font-size: 13px; }
.check-label { color: #6b7280; margin-right: 4px; }
.countdown { color: #b45309; font-weight: 700; font-size: 13px; }
.release-actions { margin-top: 10px; padding-top: 10px; border-top: 1px dashed #e5e7eb; }
.release-card.obsolete .release-version { color: #9ca3af; text-decoration: line-through; }
@media (max-width: 720px) { .topbar { padding: 18px; flex-direction: column; align-items: flex-start; } .content { padding: 16px; } }
</style>
