import { useRef, useState } from "react";
import { Download, Image as ImageIcon } from "lucide-react";
import { toJpeg, toPng } from "html-to-image";

type VoteItem = {
  rank?: number;
  name: string;
  subtitle?: string | null;
  points: number;
};

type VoteOverviewDownloadProps = {
  roundName: string;
  editionName?: string | null;
  voterName: string;
  voterCountry: string;
  totalPoints: number;
  votes: VoteItem[];
};

export function VoteOverviewDownload({
  roundName,
  editionName,
  voterName,
  voterCountry,
  totalPoints,
  votes,
}: VoteOverviewDownloadProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isDownloading, setIsDownloading] = useState<"png" | "jpg" | null>(null);

  const fileBaseName = `${(editionName ?? "solaris")
    .replace(/\s+/g, "-")
    .toLowerCase()}-${roundName.replace(/\s+/g, "-").toLowerCase()}-vote-overview`;

  async function downloadAsPng() {
    if (!cardRef.current) return;
    try {
      setIsDownloading("png");

      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#07133a",
      });

      const link = document.createElement("a");
      link.download = `${fileBaseName}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error("Failed to export PNG", error);
    } finally {
      setIsDownloading(null);
    }
  }

  async function downloadAsJpg() {
    if (!cardRef.current) return;
    try {
      setIsDownloading("jpg");

      const dataUrl = await toJpeg(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        quality: 0.95,
        backgroundColor: "#07133a",
      });

      const link = document.createElement("a");
      link.download = `${fileBaseName}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error("Failed to export JPG", error);
    } finally {
      setIsDownloading(null);
    }
  }

  return (
    <div className="space-y-4">
      <div
        ref={cardRef}
        className="glass-strong rounded-[32px] border border-white/15 p-5 sm:p-6"
        style={{
          background:
            "radial-gradient(circle at top left, rgba(255,255,255,0.16), rgba(255,255,255,0.05) 32%, rgba(9,27,94,0.66) 72%, rgba(0,125,191,0.34) 100%)",
        }}
      >
        <div className="mb-5 text-center">
          <p className="text-[11px] uppercase tracking-[0.3em] text-primary">
            Your vote overview
          </p>

          <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
            {editionName ? `${editionName} · ${roundName}` : roundName}
          </h2>

          <p className="mt-2 text-sm text-white/70">
            Submitted by <span className="font-medium text-white">{voterName}</span>{" "}
            from <span className="font-medium text-white">{voterCountry}</span>
          </p>

          <p className="mt-1 text-sm text-white/70">
            Total allocated points:{" "}
            <span className="font-semibold text-white">{totalPoints}</span>
          </p>
        </div>

        <div className="space-y-2">
          {votes
            .slice()
            .sort((a, b) => b.points - a.points)
            .map((vote, index) => (
              <div
                key={`${vote.name}-${index}`}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">
                      {vote.rank ?? index + 1}
                    </div>

                    <p className="truncate text-base font-medium text-white">
                      {vote.name}
                    </p>
                  </div>

                  {vote.subtitle ? (
                    <p className="mt-1 truncate pl-9 text-xs text-white/60">
                      {vote.subtitle}
                    </p>
                  ) : null}
                </div>

                <div className="ml-4 text-right">
                  <p className="text-xl font-semibold leading-none text-white tabular-nums">
                    {vote.points}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/60">
                    points
                  </p>
                </div>
              </div>
            ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={downloadAsPng}
          disabled={isDownloading !== null}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.1] disabled:opacity-60"
        >
          <Download className="h-4 w-4" />
          {isDownloading === "png" ? "Exporting PNG..." : "Download PNG"}
        </button>

        <button
          type="button"
          onClick={downloadAsJpg}
          disabled={isDownloading !== null}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.1] disabled:opacity-60"
        >
          <ImageIcon className="h-4 w-4" />
          {isDownloading === "jpg" ? "Exporting JPG..." : "Download JPG"}
        </button>
      </div>
    </div>
  );
}
