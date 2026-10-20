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

function BidiText({ children }: { children: React.ReactNode }) {
  return <bdi dir="auto">{children}</bdi>;
}

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
  if (loading) return <p role="status"><BidiText>{labels.registryLoading}</BidiText></p>;
  if (error && !site && !sites.length) return <section role="alert"><p><BidiText>{error}</BidiText></p><Button onClick={() => void load()}><BidiText>{labels.siteReloadLatest}</BidiText></Button></section>;
  if (!slug) return <section>
    <h2 className="text-lg font-semibold"><BidiText>{labels.registryTitle}</BidiText></h2>
    {error && <p role="alert"><BidiText>{error}</BidiText></p>}
    {sites.length === 0 ? <p className="mt-4 text-kumo-subtle"><BidiText>{labels.registryEmpty}</BidiText></p> : <ul className="mt-4 grid gap-3 sm:grid-cols-2">
      {sites.map((item) => <li key={item.id} className="min-w-0 rounded-xl border border-kumo-line bg-kumo-base p-4">
        <LinkButton href={"/site/" + encodeURIComponent(item.slug)} variant="secondary" className="min-w-0 max-w-full whitespace-normal break-words text-start"><bdi className="max-w-full whitespace-normal break-words" dir="auto">{item.title || item.slug}</bdi></LinkButton>
        <p className="mt-2 min-w-0 break-words text-sm"><b><BidiText>{labels.siteSlug}:</BidiText></b> <code className="break-all"><bdi dir="ltr">{item.slug}</bdi></code></p>
        <p className="text-sm"><BidiText>{statusText(item)}</BidiText></p>
        <p className="mt-2 text-sm"><b><BidiText>{labels.siteDomains}:</BidiText></b> {item.domains.length ? item.domains.map((domain) => <bdi className="me-2 inline-block break-all" dir="ltr" key={domain}>{domain}</bdi>) : "-"}</p>
        <p className="mt-1 text-sm"><b><BidiText>{labels.siteReadiness}:</BidiText></b> <BidiText>{item.readiness.status === "ready" ? labels.siteReady : labels.siteUnavailable}</BidiText></p>
        {item.readiness.status === "unavailable" && <p className="mt-1 break-words text-sm text-kumo-subtle"><BidiText>{labels.siteUnavailableExplanation}</BidiText></p>}
        <p className="mt-1 break-words text-xs text-kumo-subtle"><BidiText>{labels.siteLoadedVersion}:</BidiText> <code className="break-all"><bdi dir="ltr">{item.readiness.loadedVersion || "-"}</bdi></code></p>
        <p className="break-words text-xs text-kumo-subtle"><BidiText>{labels.siteLatestVersion}:</BidiText> <code className="break-all"><bdi dir="ltr">{item.readiness.latestVersion || "-"}</bdi></code></p>
        {item.readiness.pendingRestart && <p className="mt-1 break-words text-xs"><BidiText>{labels.sitePendingRestart}</BidiText></p>}
        {item.status === "disabled" && <p className="mt-1 break-words text-xs text-kumo-subtle"><BidiText>{labels.siteDisabledExplanation}</BidiText></p>}
      </li>)}
    </ul>}
  </section>;

  if (error && !site) return <section role="alert"><p><BidiText>{error}</BidiText></p><Button onClick={() => void load()}><BidiText>{labels.siteReloadLatest}</BidiText></Button></section>;
  if (!site) return null;
  return <section className="min-w-0 space-y-5">
    <p className="min-w-0 break-words text-sm"><b><BidiText>{labels.siteSlug}:</BidiText></b> <code className="break-all"><bdi dir="ltr">{site.slug}</bdi></code></p>
    <p><b><BidiText>{labels.siteStatus}:</BidiText></b> <BidiText>{statusText(site)}</BidiText></p>
    {site.status === "disabled" && <p className="break-words rounded-lg bg-kumo-tint p-3 text-sm"><BidiText>{labels.siteDisabledExplanation}</BidiText></p>}
    <div className="min-w-0"><h2 className="font-semibold"><BidiText>{labels.siteDomains}</BidiText></h2>{site.domains.length ? <ul className="min-w-0">{site.domains.map((domain) => <li className="break-all" key={domain}><bdi dir="ltr">{domain}</bdi></li>)}</ul> : <p>-</p>}</div>
    <div className="min-w-0"><h2 className="font-semibold"><BidiText>{labels.siteReadiness}</BidiText></h2><p><BidiText>{site.readiness.status === "ready" ? labels.siteReady : labels.siteUnavailable}</BidiText></p>
      {site.readiness.status === "unavailable" && <p className="mt-2 break-words rounded-lg bg-kumo-tint p-3 text-sm"><BidiText>{labels.siteUnavailableExplanation}</BidiText></p>}
      <p className="mt-2 min-w-0 break-words text-sm"><BidiText>{labels.siteLoadedVersion}:</BidiText> <code className="break-all"><bdi dir="ltr">{site.readiness.loadedVersion || "-"}</bdi></code></p>
      <p className="min-w-0 break-words text-sm"><BidiText>{labels.siteLatestVersion}:</BidiText> <code className="break-all"><bdi dir="ltr">{site.readiness.latestVersion || "-"}</bdi></code></p>
      {site.readiness.pendingRestart && <p className="mt-2 break-words text-sm"><BidiText>{labels.sitePendingRestart}</BidiText></p>}
    </div>
    <form onSubmit={saveTitle} className="min-w-0 max-w-xl space-y-3">
      <Input label={<BidiText>{labels.siteTitle}</BidiText>} value={title} onChange={(event) => setTitle(event.target.value)} />
      <p className="break-words text-sm text-kumo-subtle"><BidiText>{labels.siteTitleHelp}</BidiText></p>
      <Button type="submit" loading={saving} disabled={saving}><BidiText>{labels.siteSaveTitle}</BidiText></Button>
      {conflict && <div role="alert" className="space-y-2"><p className="break-words"><BidiText>{labels.siteTitleConflict}</BidiText></p><Button type="button" variant="secondary" onClick={() => { setConflict(false); void load(); }}><BidiText>{labels.siteReloadLatest}</BidiText></Button></div>}
      {error && <p role="alert"><BidiText>{error}</BidiText></p>}
    </form>
    <div className="space-y-2"><Button type="button" variant="secondary" disabled><BidiText>{labels.siteOpenAdmin}</BidiText></Button><p className="break-words text-sm text-kumo-subtle"><BidiText>{labels.siteAdminUnavailableExplanation}</BidiText></p></div>
  </section>;
}
`;
