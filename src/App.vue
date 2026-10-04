<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useOnline } from '@vueuse/core';
import { toTypedSchema } from '@vee-validate/zod';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import { REQUIRED_ROLES, useFlagStore, type Release } from './stores/flags';

const store = useFlagStore();
const online = useOnline();
const active = computed(() => store.active);
const releases = computed(() => (active.value ? store.releasesOf(active.value.id) : []));
const liveRelease = computed(() => (active.value ? store.effectiveOf(active.value.id) : undefined));
const previousRelease = computed(() => (active.value ? store.previousEffectiveOf(active.value.id) : undefined));
const dependencies = computed(() => (active.value?.dependsOn ?? []).map((id) => store.flagById(id)).filter((item) => item !== undefined));
const createOpen = ref(false);
const simulation = ref<{ hit: boolean; reason: string } | null>(null);
const user = reactive({ id: 'user-1042', region: '上海', appVersion: '8.3.0', authenticated: true });
const now = ref(new Date());
let timer: number | undefined;

onMounted(() => {
  store.tick();
  timer = window.setInterval(() => { now.value = new Date(); store.tick(); }, 1000);
});
onUnmounted(() => window.clearInterval(timer));

const schema = toTypedSchema(z.object({ name: z.string().min(3), key: z.string().regex(/^[a-z0-9-]+$/, '仅支持小写字母、数字和连字符') }));
const { defineField, errors, handleSubmit, resetForm } = useForm({ validationSchema: schema });
const [name] = defineField('name');
const [key] = defineField('key');
const create = handleSubmit((values) => { store.createFlag(values.name, values.key); createOpen.value = false; resetForm(); });

function simulate() { simulation.value = store.simulateHit(user); }
function fmtTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}
function releaseTag(release: Release) {
  if (release.status === 'effective') return { color: 'green', text: '正在生效' };
  if (release.status === 'voided') return { color: 'default', text: '已经作废' };
  if (release.failureReason) return { color: 'orange', text: '待处理' };
  return { color: 'gold', text: '等待生效' };
}
function rulesText(release: Release) {
  return `${release.rules.region} · ${release.rules.appVersion}${release.rules.authenticated ? ' · 需登录' : ''}`;
}
</script>

<template>
  <a-config-provider><a-layout class="app-shell">
    <a-layout-header class="topbar">
      <div><div class="eyebrow">FEATURE FLAG / PORT 62023</div><h1>{{ $t('title') }}</h1></div>
      <a-space>
        <a-tag color="purple">当前时间 {{ now.toLocaleString('zh-CN', { hour12: false }) }}</a-tag>
        <a-tag :color="online ? 'green' : 'orange'">{{ online ? '控制面在线' : '离线草稿' }}</a-tag>
        <a-button type="primary" @click="createOpen = true">新建功能开关</a-button>
      </a-space>
    </a-layout-header>
    <a-layout-content class="content">
      <a-alert v-if="!online" type="warning" show-icon message="离线状态" description="规则修改保留在浏览器，恢复网络后仍需完成审批才能发布。" class="mb" />
      <a-row :gutter="[18,18]">
        <a-col :xs="24" :lg="7">
          <a-card title="功能开关" size="small">
            <a-list :data-source="store.flags" bordered>
              <template #renderItem="{ item }">
                <a-list-item :class="{ selected: item.id === store.activeId }" @click="store.select(item.id)">
                  <a-list-item-meta>
                    <template #title>
                      <a-space>
                        <span>{{ item.name }}</span>
                        <a-tag :color="item.enabled ? 'green' : 'default'">{{ item.enabled ? '启用中' : '已停用' }}</a-tag>
                        <a-tag v-if="store.effectiveOf(item.id)" color="blue">v{{ store.effectiveOf(item.id)!.version }} 生效中</a-tag>
                        <a-tag v-else>未发布</a-tag>
                      </a-space>
                    </template>
                    <template #description>
                      <code>{{ item.key }}</code>
                      <template v-if="store.effectiveOf(item.id)"> · {{ store.effectiveOf(item.id)!.rollout }}%</template>
                      <template v-if="item.dependsOn.length"> · 依赖 {{ item.dependsOn.map((id: string) => store.flagById(id)?.key ?? id).join('、') }}</template>
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
              <template #title>线上生效 · {{ active.name }}</template>
              <template #extra>
                <a-space>
                  <a-tag :color="active.enabled ? 'green' : 'default'">{{ active.enabled ? '启用中' : '已停用' }}</a-tag>
                  <a-button danger :disabled="!active.enabled" @click="store.emergencyStop(active.id)">紧急停止</a-button>
                  <a-button danger ghost :disabled="!previousRelease" @click="store.rollback(active.id)">回滚{{ previousRelease ? `至 v${previousRelease.version}` : '' }}</a-button>
                </a-space>
              </template>
              <a-alert v-if="!liveRelease" type="info" show-icon message="当前没有正在生效的版本" description="提交候选发布并完成审批后，可立即切换或等待定时切换。" />
              <a-descriptions v-else bordered :column="{ xs: 1, md: 3 }" size="small">
                <a-descriptions-item label="生效版本">v{{ liveRelease.version }} <code class="hash">{{ liveRelease.hash }}</code></a-descriptions-item>
                <a-descriptions-item label="生效时间">{{ fmtTime(liveRelease.effectiveAt) }}</a-descriptions-item>
                <a-descriptions-item label="放量比例">{{ liveRelease.rollout }}%</a-descriptions-item>
                <a-descriptions-item label="规则" :span="2">{{ rulesText(liveRelease) }}</a-descriptions-item>
                <a-descriptions-item label="依赖开关">
                  <a-space v-if="dependencies.length">
                    <a-tag v-for="dep in dependencies" :key="dep.id" :color="dep.enabled ? 'green' : 'red'">{{ dep.key }} {{ dep.enabled ? '已启用' : '未启用' }}</a-tag>
                  </a-space>
                  <span v-else>无</span>
                </a-descriptions-item>
              </a-descriptions>
            </a-card>

            <a-card title="草稿与提交" class="mb" size="small">
              <a-form layout="vertical">
                <a-row :gutter="16">
                  <a-col :span="8"><a-form-item label="目标地区"><a-select :value="active.draftRules.region" :options="['全部','上海','北京','广东'].map((value) => ({ value, label: value }))" @change="(value: string) => store.updateDraftRule({ region: value })" /></a-form-item></a-col>
                  <a-col :span="8"><a-form-item label="客户端版本"><a-input :value="active.draftRules.appVersion" @change="(event: Event) => store.updateDraftRule({ appVersion: (event.target as HTMLInputElement).value })" /></a-form-item></a-col>
                  <a-col :span="8"><a-form-item label="登录要求"><a-switch :checked="active.draftRules.authenticated" @change="(checked: boolean) => store.updateDraftRule({ authenticated: checked })" /></a-form-item></a-col>
                </a-row>
                <a-form-item :label="`草稿放量：${active.draftRollout}%`"><a-slider :value="active.draftRollout" :min="0" :max="100" :step="5" @change="(value: number) => store.setDraftRollout(value)" /></a-form-item>
                <a-form-item label="依赖开关（切换时必须全部启用）">
                  <a-select mode="multiple" :value="active.dependsOn" :options="store.flags.filter((item) => item.id !== active!.id).map((item) => ({ value: item.id, label: `${item.name}（${item.key}）` }))" @change="(value: string[]) => store.setDependsOn(value)" />
                </a-form-item>
              </a-form>
              <a-space>
                <a-button type="primary" @click="store.submitRelease">提交候选发布</a-button>
                <span class="hint">每次提交生成带版本号的候选发布；旧候选作废，审批只认可本次提交内容。</span>
              </a-space>
            </a-card>

            <a-card title="发布线" class="mb" size="small">
              <a-empty v-if="!releases.length" description="还没有候选发布，先在上方提交。" />
              <div v-for="release in releases" :key="release.id" class="release" :class="{ muted: release.status === 'voided' }">
                <div class="release-head">
                  <a-space wrap>
                    <b>v{{ release.version }}</b>
                    <code class="hash">{{ release.hash }}</code>
                    <a-tag :color="releaseTag(release).color">{{ releaseTag(release).text }}</a-tag>
                    <span>{{ rulesText(release) }} · {{ release.rollout }}%</span>
                  </a-space>
                </div>
                <div class="release-meta">
                  提交 {{ fmtTime(release.submittedAt) }}
                  <template v-if="release.scheduledAt"> · 定时 {{ fmtTime(release.scheduledAt) }}</template>
                  <template v-if="release.effectiveAt"> · 生效 {{ fmtTime(release.effectiveAt) }}</template>
                  <template v-if="release.voidReason"> · 作废：{{ release.voidReason }}</template>
                </div>
                <a-alert v-if="release.failureReason" class="mt" type="warning" show-icon :message="`切换失败：${release.failureReason}`" description="已恢复并保持原生效版本，本次发布留作待处理，可修复后重试或重新定时。" />
                <div v-if="release.status === 'pending'" class="release-actions">
                  <a-space wrap>
                    <a-tag :color="release.approvals.includes(REQUIRED_ROLES[0]) ? 'green' : 'default'">{{ REQUIRED_ROLES[0] }} {{ release.approvals.includes(REQUIRED_ROLES[0]) ? '已批' : '待批' }}</a-tag>
                    <a-tag :color="release.approvals.includes(REQUIRED_ROLES[1]) ? 'green' : 'default'">{{ REQUIRED_ROLES[1] }} {{ release.approvals.includes(REQUIRED_ROLES[1]) ? '已批' : '待批' }}</a-tag>
                    <a-button size="small" :disabled="release.approvals.includes(REQUIRED_ROLES[0])" @click="store.approveRelease(release.id, REQUIRED_ROLES[0])">产品审批</a-button>
                    <a-button size="small" :disabled="release.approvals.includes(REQUIRED_ROLES[1])" @click="store.approveRelease(release.id, REQUIRED_ROLES[1])">研发审批</a-button>
                  </a-space>
                  <a-space wrap class="mt">
                    <a-input type="datetime-local" size="small" :value="release.scheduledAt" @change="(event: Event) => store.scheduleRelease(release.id, (event.target as HTMLInputElement).value)" />
                    <a-button size="small" type="primary" @click="store.attemptRelease(release.id, '手动')">{{ release.failureReason ? '重试切换' : '立即切换' }}</a-button>
                    <a-button size="small" danger ghost @click="store.voidRelease(release.id, '人工作废')">作废</a-button>
                  </a-space>
                </div>
              </div>
            </a-card>

            <a-card title="审计记录" size="small">
              <a-timeline>
                <a-timeline-item v-for="item in store.audit" :key="item.id" :color="item.action.includes('停止') || item.action.includes('回滚') || item.action.includes('失败') ? 'red' : item.action.includes('生效') ? 'green' : 'blue'">
                  <b>{{ fmtTime(item.at) }} · {{ item.actor }}</b>
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
        <a-form-item label="展示名称" :validate-status="errors.name ? 'error' : ''" :help="errors.name"><a-input v-model:value="name" /></a-form-item>
        <a-form-item label="开关 Key" :validate-status="errors.key ? 'error' : ''" :help="errors.key"><a-input v-model:value="key" /></a-form-item>
      </a-form>
    </a-modal>
  </a-layout></a-config-provider>
</template>

<style>
* { box-sizing: border-box; }
body { margin: 0; background: #f4f6fb; font-family: Inter, "PingFang SC", sans-serif; }
.app-shell { min-height: 100vh; background: transparent; }
.topbar { height: auto; min-height: 88px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px 32px; color: white; background: linear-gradient(120deg, #111827, #312e81); }
.topbar h1 { color: white; margin: 3px 0; font-size: 25px; }
.eyebrow { color: #a5b4fc; font-size: 11px; letter-spacing: .13em; }
.content { max-width: 1400px; width: 100%; margin: 0 auto; padding: 24px; }
.mb { margin-bottom: 18px; }.mt { margin-top: 14px; }
.selected { background: #eef2ff; cursor: pointer; }
.ant-list-item { cursor: pointer; }
.hash { font-size: 11px; color: #6366f1; background: #eef2ff; padding: 1px 6px; border-radius: 4px; }
.hint { color: #64748b; font-size: 12px; }
.release { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; background: #fff; }
.release.muted { opacity: .62; background: #f8fafc; }
.release-head { margin-bottom: 4px; }
.release-meta { color: #64748b; font-size: 12px; }
.release-actions { margin-top: 10px; }
@media (max-width: 720px) { .topbar { padding: 18px; flex-direction: column; align-items: flex-start; }.content { padding: 16px; } }
</style>
