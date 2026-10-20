export const systemSitesSource = `import { Button, Input, LinkButton } from "@cloudflare/kumo";
import * as React from "react";

interface SiteRecord {
  id: string;
  slug: string;
  status: "active" | "disabled";
  title: string | null;
  domains: string[];
  titleRevision: string | null;
  readiness: { status: "ready" | "unavailable"; loadedVersion: string | null; latestVersion: string | null; pendingRestart: boolean };
}

interface SystemSitesProps { labels: Record<string, string>; }

export function SystemSites({ labels }: SystemSitesProps) {
  const slug = typeof window === "undefined" ? "" : decodeURIComponent(window.location.pathname.split("/")[2] || "");
  const [sites, setSites] = React.useState<SiteRecord[]>([]);
  const [site, setSite] = React.useState<SiteRecord | null>(null);
  const [title, setTitle] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [conflict, setConflict] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (slug) {
        const response = await fetch("/_emdash/api/system/sites/" + encodeURIComponent(slug));
        if (!response.ok) throw new Error();
        const result = await response.json();
        const next = result.data as SiteRecord;
        setSite(next);
        setTitle(next.title || "");
      } else {
        const all: SiteRecord[] = [];
        let cursor: string | undefined;
        do {
          const query = new URLSearchParams({ limit: "100" });
          if (cursor) query.set("cursor", cursor);
          const response = await fetch("/_emdash/api/system/sites?" + query.toString());
          if (!response.ok) throw new Error();
          const result = await response.json();
          all.push(...result.data.items);
          cursor = result.data.nextCursor || undefined;
        } while (cursor);
        setSites(all);
      }
    } catch {
      setError(labels.registryLoadError);
    } finally {
      setLoading(false);
    }
  }, [slug, labels.registryLoadError]);

  React.useEffect(() => { void load(); }, [load]);

  async function saveTitle(event: React.FormEvent) {
    event.preventDefault();
    if (!site) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/_emdash/api/system/sites/" + encodeURIComponent(site.slug), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
        body: JSON.stringify({ title, expectedRevision: site.titleRevision }),
      });
      if (response.status === 409) { setConflict(true); return; }
      if (!response.ok) throw new Error();
      const result = await response.json();
      setSite(result.data);
      setTitle(result.data.title || "");
      setConflict(false);
    } catch {
      setError(labels.siteSaveError);
    } finally {
      setSaving(false);
    }
  }

  const statusText = (item: SiteRecord) => item.status === "active" ? labels.siteActive : labels.siteDisabled;
  if (loading) return <p role="status">{labels.registryLoading}</p>;
  if (error && !site && !sites.length) return <section role="alert"><p>{error}</p><Button onClick={() => void load()}>{labels.siteReloadLatest}</Button></section>;
  if (!slug) return <section>
    <h2 className="text-lg font-semibold">{labels.registryTitle}</h2>
    {error && <p role="alert">{error}</p>}
    {sites.length === 0 ? <p className="mt-4 text-kumo-subtle">{labels.registryEmpty}</p> : <ul className="mt-4 grid gap-3 sm:grid-cols-2">
      {sites.map((item) => <li key={item.id} className="min-w-0 rounded-xl border border-kumo-line bg-kumo-base p-4">
        <LinkButton href={"/site/" + encodeURIComponent(item.slug)} variant="secondary" className="min-w-0 max-w-full whitespace-normal break-words text-start"><bdi className="block max-w-full whitespace-normal break-words" dir="auto">{item.title || item.slug}</bdi></LinkButton>
        <p className="mt-2 min-w-0 break-words text-sm"><b>{labels.siteSlug}:</b> <code className="break-all"><bdi dir="ltr">{item.slug}</bdi></code></p>
        <p className="text-sm">{statusText(item)}</p>
        <p className="mt-2 text-sm"><b>{labels.siteDomains}:</b> {item.domains.length ? item.domains.map((domain) => <bdi className="me-2 inline-block break-all" dir="ltr" key={domain}>{domain}</bdi>) : "-"}</p>
        <p className="mt-1 text-sm"><b>{labels.siteReadiness}:</b> {item.readiness.status === "ready" ? labels.siteReady : labels.siteUnavailable}</p>
        {item.readiness.status === "unavailable" && <p className="mt-1 break-words text-sm text-kumo-subtle">{labels.siteUnavailableExplanation}</p>}
        <p className="mt-1 break-words text-xs text-kumo-subtle">{labels.siteLoadedVersion}: <code className="break-all"><bdi dir="ltr">{item.readiness.loadedVersion || "-"}</bdi></code></p>
        <p className="break-words text-xs text-kumo-subtle">{labels.siteLatestVersion}: <code className="break-all"><bdi dir="ltr">{item.readiness.latestVersion || "-"}</bdi></code></p>
        {item.readiness.pendingRestart && <p className="mt-1 break-words text-xs">{labels.sitePendingRestart}</p>}
        {item.status === "disabled" && <p className="mt-1 break-words text-xs text-kumo-subtle">{labels.siteDisabledExplanation}</p>}
      </li>)}
    </ul>}
  </section>;

  if (error && !site) return <section role="alert"><p>{error}</p><Button onClick={() => void load()}>{labels.siteReloadLatest}</Button></section>;
  if (!site) return null;
  return <section className="min-w-0 space-y-5">
    <p className="min-w-0 break-words text-sm"><b>{labels.siteSlug}:</b> <code className="break-all"><bdi dir="ltr">{site.slug}</bdi></code></p>
    <p><b>{labels.siteStatus}:</b> {statusText(site)}</p>
    {site.status === "disabled" && <p className="break-words rounded-lg bg-kumo-tint p-3 text-sm">{labels.siteDisabledExplanation}</p>}
    <div className="min-w-0"><h2 className="font-semibold">{labels.siteDomains}</h2>{site.domains.length ? <ul className="min-w-0">{site.domains.map((domain) => <li className="break-all" key={domain}><bdi dir="ltr">{domain}</bdi></li>)}</ul> : <p>-</p>}</div>
    <div className="min-w-0"><h2 className="font-semibold">{labels.siteReadiness}</h2><p>{site.readiness.status === "ready" ? labels.siteReady : labels.siteUnavailable}</p>
      {site.readiness.status === "unavailable" && <p className="mt-2 break-words rounded-lg bg-kumo-tint p-3 text-sm">{labels.siteUnavailableExplanation}</p>}
      <p className="mt-2 min-w-0 break-words text-sm">{labels.siteLoadedVersion}: <code className="break-all"><bdi dir="ltr">{site.readiness.loadedVersion || "-"}</bdi></code></p>
      <p className="min-w-0 break-words text-sm">{labels.siteLatestVersion}: <code className="break-all"><bdi dir="ltr">{site.readiness.latestVersion || "-"}</bdi></code></p>
      {site.readiness.pendingRestart && <p className="mt-2 break-words text-sm">{labels.sitePendingRestart}</p>}
    </div>
    <form onSubmit={saveTitle} className="min-w-0 max-w-xl space-y-3">
      <Input label={labels.siteTitle} value={title} onChange={(event) => setTitle(event.target.value)} />
      <p className="break-words text-sm text-kumo-subtle">{labels.siteTitleHelp}</p>
      <Button type="submit" loading={saving} disabled={saving}>{labels.siteSaveTitle}</Button>
      {conflict && <div role="alert" className="space-y-2"><p className="break-words">{labels.siteTitleConflict}</p><Button type="button" variant="secondary" onClick={() => { setConflict(false); void load(); }}>{labels.siteReloadLatest}</Button></div>}
      {error && <p role="alert">{error}</p>}
    </form>
    <div className="space-y-2"><Button type="button" variant="secondary" disabled>{labels.siteOpenAdmin}</Button><p className="break-words text-sm text-kumo-subtle">{labels.siteAdminUnavailableExplanation}</p></div>
  </section>;
}
`;
