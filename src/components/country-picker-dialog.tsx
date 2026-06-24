import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, X, GripVertical, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

const MAX = 26;

type Country = { code: string; name: string; flag: string };

export function CountryPickerDialog({
  open,
  onOpenChange,
  roundId,
  roundName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  roundId: string | null;
  roundName: string;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]); // ordered country codes

  const { data: countries } = useQuery({
    queryKey: ["countries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("countries")
        .select("code,name,flag")
        .order("name");
      if (error) throw error;
      return data as Country[];
    },
  });

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ["round_countries", roundId],
    queryFn: async () => {
      if (!roundId) return [];
      const { data, error } = await supabase
        .from("round_countries")
        .select("country_code,display_order")
        .eq("round_id", roundId)
        .order("display_order");
      if (error) throw error;
      return data as { country_code: string; display_order: number }[];
    },
    enabled: !!roundId && open,
  });

  useEffect(() => {
    if (open && existing) {
      setSelected(existing.map((r) => r.country_code));
    }
    if (!open) setSearch("");
  }, [open, existing]);

  const byCode = useMemo(() => {
    const m = new Map<string, Country>();
    (countries ?? []).forEach((c) => m.set(c.code, c));
    return m;
  }, [countries]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return (countries ?? []).filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [countries, search]);

  const toggle = (code: string) => {
    setSelected((prev) => {
      if (prev.includes(code)) return prev.filter((c) => c !== code);
      if (prev.length >= MAX) {
        toast.error(`Maximum ${MAX} countries`);
        return prev;
      }
      return [...prev, code];
    });
  };

  const move = (idx: number, dir: -1 | 1) => {
    setSelected((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!roundId) throw new Error("No round");
      if (selected.length !== MAX) throw new Error(`Need exactly ${MAX} countries`);
      const { error: delErr } = await supabase
        .from("round_countries")
        .delete()
        .eq("round_id", roundId);
      if (delErr) throw delErr;
      const rows = selected.map((code, i) => ({
        round_id: roundId,
        country_code: code,
        display_order: i + 1,
      }));
      const { error: insErr } = await supabase.from("round_countries").insert(rows);
      if (insErr) throw insErr;
    },
    onSuccess: () => {
      toast.success("Countries saved");
      qc.invalidateQueries({ queryKey: ["round_countries", roundId] });
      qc.invalidateQueries({ queryKey: ["round_country_counts"] });
      qc.invalidateQueries({ queryKey: ["public-open-round"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const count = selected.length;
  const canSave = count === MAX;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] p-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle>Configure countries · {roundName}</DialogTitle>
          <DialogDescription>
            Pick exactly {MAX} countries. Order matters — drag with the arrows.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 grid md:grid-cols-2 min-h-0">
          {/* Left: search list */}
          <div className="flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-border">
            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search countries…"
                  className="pl-9"
                />
              </div>
            </div>
            <ScrollArea className="flex-1 max-h-[45vh] md:max-h-[60vh]">
              {loadingExisting ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                </div>
              ) : (
                <ul className="p-2">
                  {filtered.map((c) => {
                    const checked = selected.includes(c.code);
                    return (
                      <li key={c.code}>
                        <button
                          type="button"
                          onClick={() => toggle(c.code)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-muted/50 transition",
                            checked && "bg-primary/10 ring-1 ring-primary/30",
                          )}
                        >
                          <Checkbox checked={checked} className="pointer-events-none" />
                          <span className="text-xl leading-none">{c.flag}</span>
                          <span className="flex-1 text-sm truncate">{c.name}</span>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {c.code}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {filtered.length === 0 && (
                    <li className="p-6 text-center text-sm text-muted-foreground">
                      No matches
                    </li>
                  )}
                </ul>
              )}
            </ScrollArea>
          </div>

          {/* Right: selection */}
          <div className="flex flex-col min-h-0">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <div className="text-sm font-medium">Selected</div>
              <Badge
                className={cn(
                  "tabular-nums",
                  canSave ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                )}
              >
                {count} / {MAX}
              </Badge>
            </div>
            <ScrollArea className="flex-1 max-h-[45vh] md:max-h-[60vh]">
              {selected.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No countries selected yet
                </div>
              ) : (
                <ol className="p-2 space-y-1">
                  {selected.map((code, i) => {
                    const c = byCode.get(code);
                    return (
                      <li
                        key={code}
                        className="flex items-center gap-2 px-2 py-2 rounded-lg bg-card/60 border border-border"
                      >
                        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="w-6 text-xs tabular-nums text-muted-foreground">
                          {i + 1}.
                        </span>
                        <span className="text-xl leading-none">{c?.flag ?? "🏳️"}</span>
                        <span className="flex-1 text-sm truncate">{c?.name ?? code}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => move(i, 1)}
                          disabled={i === selected.length - 1}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => toggle(code)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={!canSave || saveMut.isPending}
            className="bg-hero text-primary-foreground shadow-glow"
          >
            {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save {count}/{MAX}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
