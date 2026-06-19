"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  NEWS_CATEGORY_LABELS,
  NEWS_CATEGORY_ORDER,
  type NewsAdminData,
  type NewsCategory,
  type NewsPreferencesPatch,
  type NewsProviderView,
  type NewsTenantPreferences,
} from "@/modules/news";
import { Toggle } from "./toggle";
import {
  runNewsIngestionAction,
  saveNewsPreferencesAction,
  saveNewsProviderAction,
  testNewsProviderAction,
} from "@/app/(app)/sources/news-actions";

type ListKey =
  | "regions"
  | "countries"
  | "keywords"
  | "peopleToMonitor"
  | "companiesToMonitor"
  | "preferredSources"
  | "blockedSources"
  | "languages";

const LIST_FIELDS: readonly {
  key: ListKey;
  label: string;
  hint: string;
  placeholder: string;
}[] = [
  {
    key: "keywords",
    label: "Keywords & custom topics",
    hint: "Comma-separated. Used for provider queries and relevance ranking.",
    placeholder: "stablecoin, cross-border payments, EU AI Act",
  },
  {
    key: "companiesToMonitor",
    label: "Companies to monitor",
    hint: "Company mentions receive a strong relevance boost.",
    placeholder: "Stripe, Adyen, OpenAI",
  },
  {
    key: "peopleToMonitor",
    label: "People to monitor",
    hint: "Exact-name matching for the MVP classifier.",
    placeholder: "Jane Doe, Sam Altman",
  },
  {
    key: "countries",
    label: "Countries",
    hint: "Country filters are passed to providers that support them.",
    placeholder: "Netherlands, Zimbabwe, South Africa",
  },
  {
    key: "regions",
    label: "Regions",
    hint: "Regional intent used by compatible providers and classification.",
    placeholder: "Europe, Southern Africa",
  },
  {
    key: "preferredSources",
    label: "Preferred publications",
    hint: "Publisher names, not credentials. Matching sources are preferred.",
    placeholder: "Reuters, Financial Times",
  },
  {
    key: "blockedSources",
    label: "Blocked publications",
    hint: "Matching sources are dropped before storage and briefing selection.",
    placeholder: "example.com",
  },
  {
    key: "languages",
    label: "Languages",
    hint: "ISO language codes where supported.",
    placeholder: "en, nl",
  },
];

function commaList(value: string): string[] {
  return [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))];
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString("en-GB");
}

export function NewsSourceConfig({ data }: { data: NewsAdminData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [preferences, setPreferences] = useState(data.preferences);
  const [providers, setProviders] = useState<readonly NewsProviderView[]>(
    data.providers,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providerMessages, setProviderMessages] = useState<
    Record<string, string>
  >({});

  function update<K extends keyof NewsTenantPreferences>(
    key: K,
    value: NewsTenantPreferences[K],
  ) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  function save() {
    setMessage(null);
    setError(null);
    const patch: NewsPreferencesPatch = {
      enabled: preferences.enabled,
      briefingEnabled: preferences.briefingEnabled,
      categories: [...preferences.categories],
      regions: [...preferences.regions],
      countries: [...preferences.countries],
      keywords: [...preferences.keywords],
      peopleToMonitor: [...preferences.peopleToMonitor],
      companiesToMonitor: [...preferences.companiesToMonitor],
      preferredSources: [...preferences.preferredSources],
      blockedSources: [...preferences.blockedSources],
      languages: [...preferences.languages],
      maxItemsPerBriefing: preferences.maxItemsPerBriefing,
      minRelevanceScore: preferences.minRelevanceScore,
      includeGlobalHeadlines: preferences.includeGlobalHeadlines,
      includeMarketNews: preferences.includeMarketNews,
      includeRegulatoryNews: preferences.includeRegulatoryNews,
      includeAiNews: preferences.includeAiNews,
    };
    startTransition(async () => {
      const result = await saveNewsPreferencesAction(patch);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreferences(result.preferences);
      setMessage("News preferences saved.");
      router.refresh();
    });
  }

  function fetchNow() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await runNewsIngestionAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const providerNote =
        result.providerErrors.length > 0
          ? ` ${result.providerErrors.length} provider error${result.providerErrors.length === 1 ? "" : "s"} were isolated.`
          : "";
      setMessage(
        `Fetched ${result.fetched}; stored ${result.stored}; ${result.candidates} met the relevance threshold.${providerNote}`,
      );
      router.refresh();
    });
  }

  function saveProvider(
    provider: NewsProviderView,
    patch: { enabled?: boolean; feedUrls?: string[] },
  ) {
    setError(null);
    startTransition(async () => {
      const result = await saveNewsProviderAction({
        providerKey: provider.key,
        ...patch,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setProviders(result.providers);
      setMessage(`${provider.name} updated.`);
      router.refresh();
    });
  }

  function testProvider(provider: NewsProviderView) {
    startTransition(async () => {
      const result = await testNewsProviderAction({
        providerKey: provider.key,
      });
      setProviderMessages((current) => ({
        ...current,
        [provider.key]: result.ok ? result.detail : result.error,
      }));
    });
  }

  function toggleCategory(category: NewsCategory) {
    update(
      "categories",
      preferences.categories.includes(category)
        ? preferences.categories.filter((entry) => entry !== category)
        : [...preferences.categories, category],
    );
  }

  return (
    <div className="stack" style={{ gap: "var(--space-lg)" }}>
      <section className="card">
        <div className="card-head">
          <div>
            <p className="eyebrow">Optional source</p>
            <h2 className="card__title">News Briefing</h2>
          </div>
          <span className={`status status--${preferences.enabled ? "ok" : "neutral"}`}>
            {preferences.enabled ? "Active" : "Off"}
          </span>
        </div>
        <p className="action-card__rationale">
          News is off by default and never becomes a generic feed. Only external
          signals matching this workspace&apos;s preferences and relevance
          threshold can reach the daily briefing.
        </p>
        <div className="news-toggle-row">
          <span>
            <strong>Enable News ingestion</strong>
            <span className="field__hint">Fetch and rank configured providers.</span>
          </span>
          <Toggle
            pressed={preferences.enabled}
            onChange={(value) => update("enabled", value)}
            label="Enable News ingestion"
          />
        </div>
        <div className="news-toggle-row">
          <span>
            <strong>Include external signals in the daily briefing</strong>
            <span className="field__hint">
              Requires News ingestion and at least one relevant candidate.
            </span>
          </span>
          <Toggle
            pressed={preferences.briefingEnabled}
            onChange={(value) => update("briefingEnabled", value)}
            label="Include News in the daily briefing"
            disabled={!preferences.enabled}
          />
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Categories</h2>
        <p className="action-card__rationale">
          Choose any combination. Category intent is combined with your custom
          keywords and monitored entities.
        </p>
        <div className="news-option-grid">
          {NEWS_CATEGORY_ORDER.map((category) => (
            <label className="news-check" key={category}>
              <input
                type="checkbox"
                checked={preferences.categories.includes(category)}
                onChange={() => toggleCategory(category)}
              />
              <span>{NEWS_CATEGORY_LABELS[category]}</span>
            </label>
          ))}
        </div>
        <div className="news-toggle-grid">
          {(
            [
              ["includeGlobalHeadlines", "Global headlines"],
              ["includeMarketNews", "Markets"],
              ["includeRegulatoryNews", "Regulatory"],
              ["includeAiNews", "AI & technology"],
            ] as const
          ).map(([key, label]) => (
            <label className="news-check" key={key}>
              <input
                type="checkbox"
                checked={preferences[key]}
                onChange={(event) => update(key, event.target.checked)}
              />
              <span>{label} shortcut</span>
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Relevance scope</h2>
        <div className="grid grid--2" style={{ marginTop: "var(--space-md)" }}>
          {LIST_FIELDS.map((field) => (
            <div className="field" key={field.key}>
              <label className="field__label" htmlFor={`news-${field.key}`}>
                {field.label}
              </label>
              <input
                id={`news-${field.key}`}
                className="input"
                value={preferences[field.key].join(", ")}
                placeholder={field.placeholder}
                onChange={(event) =>
                  update(field.key, commaList(event.target.value))
                }
              />
              <span className="field__hint">{field.hint}</span>
            </div>
          ))}
        </div>
        <div className="grid grid--2">
          <div className="field">
            <label className="field__label" htmlFor="news-max-items">
              Max items per briefing
            </label>
            <input
              id="news-max-items"
              className="input"
              type="number"
              min={1}
              max={25}
              value={preferences.maxItemsPerBriefing}
              onChange={(event) =>
                update("maxItemsPerBriefing", Number(event.target.value))
              }
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="news-min-score">
              Minimum relevance (0 to 1)
            </label>
            <input
              id="news-min-score"
              className="input"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={preferences.minRelevanceScore}
              onChange={(event) =>
                update("minRelevanceScore", Number(event.target.value))
              }
            />
          </div>
        </div>
        <div className="integration__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={pending}
            onClick={save}
          >
            {pending ? "Working…" : "Save preferences"}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={pending || !preferences.enabled}
            onClick={fetchNow}
          >
            Fetch now
          </button>
        </div>
        {message ? <p className="form-message form-message--ok">{message}</p> : null}
        {error ? <p className="form-message form-message--error">{error}</p> : null}
      </section>

      <section className="card">
        <h2 className="card__title">Providers</h2>
        <p className="action-card__rationale">
          RSS and GDELT are implemented. Development-only and future providers
          stay visible but cannot be enabled until an adaptor is added.
        </p>
        <div className="stack" style={{ gap: "var(--space-md)" }}>
          {providers.map((provider) => (
            <ProviderControl
              key={provider.key}
              provider={provider}
              pending={pending}
              message={providerMessages[provider.key]}
              onSave={(patch) => saveProvider(provider, patch)}
              onTest={() => testProvider(provider)}
            />
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card__title">Recent fetched items</h2>
          {data.latestRun ? (
            <span className={`status status--${data.latestRun.status === "failed" ? "risk" : data.latestRun.status === "partial" ? "warn" : "ok"}`}>
              Last run: {data.latestRun.status}
            </span>
          ) : null}
        </div>
        {data.latestRun ? (
          <p className="scaffold-note">
            {formatTimestamp(data.latestRun.startedAt)} · fetched {data.latestRun.fetched}
            {" · "}stored {data.latestRun.stored}
            {" · "}candidates {data.latestRun.candidates}
          </p>
        ) : null}
        {data.recentItems.length === 0 ? (
          <div className="empty">
            <p className="empty__title">No News items yet</p>
            <p className="empty__body">
              Enable News, configure at least one topic, then fetch now.
            </p>
          </div>
        ) : (
          <div className="stack">
            {data.recentItems.map((item) => (
              <article className="news-admin-item" key={item.id}>
                <div>
                  <a
                    href={item.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="source-ref__system"
                  >
                    {item.title}
                  </a>
                  <p className="memo-item__detail">
                    {item.sourceName} · {formatTimestamp(item.publishedAt)}
                  </p>
                </div>
                <div className="source-ref-row">
                  {item.category ? (
                    <span className="chip">
                      {NEWS_CATEGORY_LABELS[item.category]}
                    </span>
                  ) : null}
                  {item.relevanceScore !== null ? (
                    <span className="source-ref">
                      relevance {Math.round(item.relevanceScore * 100)}%
                    </span>
                  ) : (
                    <span className="badge badge--plain">Below threshold</span>
                  )}
                </div>
                {item.rankReason ? (
                  <details className="news-why">
                    <summary>Why this item was included</summary>
                    <pre>{JSON.stringify(item.rankReason, null, 2)}</pre>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card__title">Configuration audit</h2>
        {data.recentAudit.length === 0 ? (
          <p className="scaffold-note">No configuration changes recorded yet.</p>
        ) : (
          <div className="stack" style={{ gap: "var(--space-sm)" }}>
            {data.recentAudit.map((entry) => (
              <div className="meta-row" key={entry.id}>
                <span className="meta-row__key">{entry.field}</span>
                <span className="meta-row__value mono">
                  {formatTimestamp(entry.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="scaffold-note">
        Only metadata, a short provider snippet, classifications, and the
        canonical link are stored. Full article bodies are not retained.
      </p>
    </div>
  );
}

function ProviderControl({
  provider,
  pending,
  message,
  onSave,
  onTest,
}: {
  provider: NewsProviderView;
  pending: boolean;
  message?: string;
  onSave: (patch: { enabled?: boolean; feedUrls?: string[] }) => void;
  onTest: () => void;
}) {
  const [feeds, setFeeds] = useState(provider.feedUrls.join("\n"));
  const unavailable = !provider.platformEnabled || !provider.implemented;
  return (
    <div className="news-provider">
      <div className="card-head">
        <div>
          <p className="integration__name">{provider.name}</p>
          <p className="integration__kind">
            {provider.tier === "development" ? "Development only" : "Production tier"}
          </p>
        </div>
        <Toggle
          pressed={provider.enabled}
          onChange={(enabled) => onSave({ enabled })}
          label={`Enable ${provider.name}`}
          disabled={pending || unavailable}
        />
      </div>
      {provider.key === "rss" ? (
        <div className="field" style={{ marginTop: "var(--space-md)" }}>
          <label className="field__label" htmlFor="news-rss-feeds">
            Trusted RSS / Atom feed URLs
          </label>
          <textarea
            id="news-rss-feeds"
            className="textarea mono"
            rows={4}
            value={feeds}
            placeholder={"https://publication.example/feed.xml\nhttps://another.example/rss"}
            onChange={(event) => setFeeds(event.target.value)}
          />
          <span className="field__hint">
            One public HTTP(S) URL per line. Private-network hosts are rejected.
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={pending}
            onClick={() =>
              onSave({
                feedUrls: feeds
                  .split(/\r?\n/)
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
          >
            Save feeds
          </button>
        </div>
      ) : null}
      <div className="integration__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={pending || unavailable || !provider.enabled}
          onClick={onTest}
        >
          Test connection
        </button>
        {unavailable ? (
          <span className="badge badge--plain">Adaptor not implemented</span>
        ) : null}
      </div>
      {message ? <p className="scaffold-note">{message}</p> : null}
    </div>
  );
}
