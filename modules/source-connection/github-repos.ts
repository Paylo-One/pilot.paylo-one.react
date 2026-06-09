import "server-only";

/**
 * modules/source-connection/github-repos.ts
 *
 * Repository-level GitHub monitoring (ADR-024). Discovers the repositories the
 * operator can access, persists them as *available* (inactive) monitors, lets
 * the operator activate repositories and choose per-repo signals, and ingests
 * activity **only** from active repositories — honouring the per-repo toggles.
 *
 * Client choice (mirrors source-connection/server.ts):
 *  - Discovery + sync run server-side (OAuth callback / a server action that has
 *    the access token) and use the SECRET client with an explicit tenant_id.
 *  - Operator reads/edits of the selection (UI) use the RLS USER client so
 *    isolation is enforced by policy automatically.
 *
 * Governance: architecture/source-integration-strategy.md §7,
 * services/source-connection.md, services/ingestion.md.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { githubGet } from "./github";
import { ingestProviderItems } from "@/modules/ingestion/server";
import type { ProviderRawItem } from "@/modules/ingestion";
import type {
  GitHubMonitorSettings,
  GitHubRepoVisibility,
  GitHubRepositoryMonitor,
} from "./source.types";

// --- DB row mapping ---------------------------------------------------------

interface RepoMonitorRow {
  id: string;
  repository_id: number;
  repository_full_name: string;
  description: string | null;
  visibility: string | null;
  is_active: boolean;
  monitor_pull_requests: boolean;
  monitor_issues: boolean;
  monitor_commits: boolean;
  monitor_releases: boolean;
  monitor_discussions: boolean;
  monitor_workflows: boolean;
  monitor_security_alerts: boolean;
  monitor_metadata: boolean;
  monitor_readme_docs: boolean;
  last_sync_at: string | null;
}

// Single string literal (not concatenation) so the Supabase select parser can
// type the result rather than falling back to GenericStringError.
const SELECT_COLUMNS =
  "id, repository_id, repository_full_name, description, visibility, is_active, monitor_pull_requests, monitor_issues, monitor_commits, monitor_releases, monitor_discussions, monitor_workflows, monitor_security_alerts, monitor_metadata, monitor_readme_docs, last_sync_at";

function mapRow(row: RepoMonitorRow): GitHubRepositoryMonitor {
  const fullName = row.repository_full_name;
  return {
    id: row.id,
    fullName,
    name: fullName.split("/")[1] ?? fullName,
    description: row.description,
    visibility: (row.visibility as GitHubRepoVisibility | null) ?? "private",
    isActive: row.is_active,
    lastSyncAt: row.last_sync_at,
    monitors: {
      pullRequests: row.monitor_pull_requests,
      issues: row.monitor_issues,
      commits: row.monitor_commits,
      releases: row.monitor_releases,
      discussions: row.monitor_discussions,
      workflows: row.monitor_workflows,
      securityAlerts: row.monitor_security_alerts,
      metadata: row.monitor_metadata,
      readmeDocs: row.monitor_readme_docs,
    },
  };
}

// --- Discovery (GitHub API) -------------------------------------------------

interface GithubApiRepo {
  id: number;
  full_name: string;
  description: string | null;
  private: boolean;
  visibility?: string | null;
  owner?: { login?: string } | null;
}

export interface DiscoveredRepo {
  repositoryId: number;
  fullName: string;
  ownerLogin: string;
  description: string | null;
  visibility: GitHubRepoVisibility;
}

function visibilityOf(repo: GithubApiRepo): GitHubRepoVisibility {
  if (repo.visibility === "internal") return "internal";
  return repo.private ? "private" : "public";
}

/**
 * List the repositories the authenticated user can access (their own + org
 * memberships + collaborations), most-recently-updated first. Bounded to keep
 * the discovery cost/exposure low.
 */
export async function fetchAccessibleRepositories(
  token: string,
): Promise<DiscoveredRepo[]> {
  const repos = await githubGet<GithubApiRepo[]>(
    token,
    "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
  );
  if (!repos) return [];
  return repos.map((r) => ({
    repositoryId: r.id,
    fullName: r.full_name,
    ownerLogin: r.owner?.login ?? r.full_name.split("/")[0] ?? "",
    description: r.description,
    visibility: visibilityOf(r),
  }));
}

// --- Persistence ------------------------------------------------------------

/**
 * Persist discovered repositories as *available* monitors (SECRET client,
 * explicit tenant_id). New repositories are inserted inactive; existing rows are
 * left untouched (`ignoreDuplicates`) so the operator's selections and per-repo
 * signals are never clobbered by a re-discovery. Returns how many were added.
 */
export async function upsertAvailableRepositories(
  tenantId: string,
  sourceConnectionId: string,
  repos: readonly DiscoveredRepo[],
): Promise<number> {
  if (repos.length === 0) return 0;
  const secret = createSupabaseSecretClient();
  const rows = repos.map((r) => ({
    tenant_id: tenantId,
    source_connection_id: sourceConnectionId,
    github_account_id: r.ownerLogin,
    repository_id: r.repositoryId,
    repository_full_name: r.fullName,
    description: r.description,
    visibility: r.visibility,
    // is_active + monitor_* fall to their conservative column defaults
    // (inactive; PRs/issues/releases/metadata on) — nothing is monitored yet.
  }));
  const { data, error } = await secret
    .from("github_repository_monitors")
    .upsert(rows, {
      onConflict: "source_connection_id,repository_id",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** List the operator's repository monitors for a connection (RLS user client). */
export async function listRepositoryMonitors(
  sourceConnectionId: string,
): Promise<GitHubRepositoryMonitor[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("github_repository_monitors")
    .select(SELECT_COLUMNS)
    .eq("source_connection_id", sourceConnectionId)
    .order("repository_full_name", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RepoMonitorRow[]).map(mapRow);
}

/** Fields the operator may change on a repository monitor. */
export interface RepoMonitorPatch {
  isActive?: boolean;
  monitors?: Partial<GitHubMonitorSettings>;
}

const MONITOR_COLUMN: Record<keyof GitHubMonitorSettings, string> = {
  pullRequests: "monitor_pull_requests",
  issues: "monitor_issues",
  commits: "monitor_commits",
  releases: "monitor_releases",
  discussions: "monitor_discussions",
  workflows: "monitor_workflows",
  securityAlerts: "monitor_security_alerts",
  metadata: "monitor_metadata",
  readmeDocs: "monitor_readme_docs",
};

/**
 * Update a repository monitor (RLS user client). Tenant isolation is enforced by
 * policy: the update only matches a row the caller's tenant owns. Returns true
 * if a row was updated.
 */
export async function updateRepositoryMonitor(
  monitorId: string,
  patch: RepoMonitorPatch,
): Promise<boolean> {
  const update: Record<string, boolean> = {};
  if (typeof patch.isActive === "boolean") update.is_active = patch.isActive;
  if (patch.monitors) {
    for (const [key, value] of Object.entries(patch.monitors)) {
      if (typeof value === "boolean") {
        update[MONITOR_COLUMN[key as keyof GitHubMonitorSettings]] = value;
      }
    }
  }
  if (Object.keys(update).length === 0) return false;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("github_repository_monitors")
    .update(update)
    .eq("id", monitorId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

// --- Activity fetch + sync --------------------------------------------------

interface GhPull {
  number: number;
  title: string;
  state: string;
  user?: { login?: string } | null;
  updated_at: string | null;
  draft?: boolean;
}
interface GhIssue {
  number: number;
  title: string;
  state: string;
  user?: { login?: string } | null;
  updated_at: string | null;
  pull_request?: unknown; // issues endpoint includes PRs; we exclude these
}
interface GhCommit {
  sha: string;
  commit?: { message?: string; author?: { name?: string; date?: string } | null } | null;
  author?: { login?: string } | null;
}
interface GhRelease {
  id: number;
  name: string | null;
  tag_name: string;
  published_at: string | null;
  author?: { login?: string } | null;
}

/**
 * Fetch a bounded, read-only slice of activity for one repository, restricted to
 * the signals enabled on its monitor. Returns canonical raw items carrying
 * repository-level provenance (full name in the title + raw).
 *
 * MVP coverage: pull requests, issues, commits, releases — the always-available
 * signals. Discussions (GraphQL), workflow runs (Actions API), and security
 * alerts require extra endpoints/permissions and are persisted-but-not-fetched
 * for now (see source-integration-strategy.md §7).
 */
export async function fetchRepoActivity(
  token: string,
  fullName: string,
  monitors: GitHubMonitorSettings,
): Promise<ProviderRawItem[]> {
  const items: ProviderRawItem[] = [];
  const repo = encodeURI(fullName);

  if (monitors.pullRequests) {
    const pulls = await githubGet<GhPull[]>(
      token,
      `/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=10`,
    );
    for (const pr of pulls ?? []) {
      items.push({
        externalId: `gh:${fullName}:pr:${pr.number}`,
        title: `PR #${pr.number} ${pr.title} · ${fullName}`,
        body: `Pull request #${pr.number} (${pr.state}${pr.draft ? ", draft" : ""}) in ${fullName}: ${pr.title}`,
        author: pr.user?.login ?? null,
        occurredAt: pr.updated_at,
        kind: "pull_request",
        raw: { repository: fullName, ...(pr as unknown as Record<string, unknown>) },
      });
    }
  }

  if (monitors.issues) {
    const issues = await githubGet<GhIssue[]>(
      token,
      `/repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=10`,
    );
    for (const issue of issues ?? []) {
      if (issue.pull_request) continue; // the issues endpoint also returns PRs
      items.push({
        externalId: `gh:${fullName}:issue:${issue.number}`,
        title: `Issue #${issue.number} ${issue.title} · ${fullName}`,
        body: `Issue #${issue.number} (${issue.state}) in ${fullName}: ${issue.title}`,
        author: issue.user?.login ?? null,
        occurredAt: issue.updated_at,
        kind: "issue",
        raw: { repository: fullName, ...(issue as unknown as Record<string, unknown>) },
      });
    }
  }

  if (monitors.commits) {
    const commits = await githubGet<GhCommit[]>(
      token,
      `/repos/${repo}/commits?per_page=10`,
    );
    for (const c of commits ?? []) {
      const message = c.commit?.message?.split("\n")[0] ?? c.sha;
      items.push({
        externalId: `gh:${fullName}:commit:${c.sha}`,
        title: `Commit ${c.sha.slice(0, 7)} · ${fullName}`,
        body: `Commit in ${fullName}: ${message}`,
        author: c.author?.login ?? c.commit?.author?.name ?? null,
        occurredAt: c.commit?.author?.date ?? null,
        kind: "commit",
        raw: { repository: fullName, ...(c as unknown as Record<string, unknown>) },
      });
    }
  }

  if (monitors.releases) {
    const releases = await githubGet<GhRelease[]>(
      token,
      `/repos/${repo}/releases?per_page=5`,
    );
    for (const rel of releases ?? []) {
      items.push({
        externalId: `gh:${fullName}:release:${rel.id}`,
        title: `Release ${rel.name || rel.tag_name} · ${fullName}`,
        body: `Release ${rel.tag_name} in ${fullName}${rel.name ? `: ${rel.name}` : ""}`,
        author: rel.author?.login ?? null,
        occurredAt: rel.published_at,
        kind: "release",
        raw: { repository: fullName, ...(rel as unknown as Record<string, unknown>) },
      });
    }
  }

  return items;
}

/** Outcome of a repository sync run. */
export interface RepoSyncResult {
  repositoryCount: number;
  itemCount: number;
}

/**
 * Sync all **active** repositories for a connection: fetch activity per repo
 * (honouring each repo's signal toggles), ingest it, and stamp last_sync_at.
 * Only active repositories are touched — the Daily Memo therefore sees only
 * repositories the operator approved (ADR-024/025). Uses the SECRET client with
 * an explicit tenant_id because it needs the stored token and runs tenant-scoped.
 */
export async function syncActiveRepositories(
  tenantId: string,
  sourceConnectionId: string,
  token: string,
): Promise<RepoSyncResult> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("github_repository_monitors")
    .select(SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("source_connection_id", sourceConnectionId)
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  const active = ((data ?? []) as RepoMonitorRow[]).map(mapRow);
  let itemCount = 0;

  for (const repo of active) {
    const items = await fetchRepoActivity(token, repo.fullName, repo.monitors);
    if (items.length > 0) {
      const result = await ingestProviderItems(
        tenantId,
        sourceConnectionId,
        "github",
        items,
      );
      itemCount += result.itemCount;
    }
    await secret
      .from("github_repository_monitors")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", repo.id)
      .eq("tenant_id", tenantId);
  }

  return { repositoryCount: active.length, itemCount };
}
