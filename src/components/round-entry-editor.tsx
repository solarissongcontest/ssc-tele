import {
  useMemo,
  useState,
} from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  ArrowUp,
  Globe,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { CountryPickerDialog } from "@/components/country-picker-dialog";
import {
  EntryAvatar,
} from "@/components/entry-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  getEntryCode,
  getEntryDisplayName,
  resolveEntry,
  sortEntries,
  type CountryRecord,
  type ParticipantMode,
  type ResolvedEntry,
} from "@/lib/round-entries";
import {
  deleteCustomRoundEntry,
  reorderRoundEntries,
  saveCustomRoundEntry,
  setRoundParticipantMode,
} from "@/lib/rounds-admin.functions";
import { cn } from "@/lib/utils";

type EditableRound = {
  id: string;
  name: string;
  status: "draft" | "open" | "closed";
  participant_mode: ParticipantMode;
} | null;

type CustomEntryForm = {
  id: string | null;
  customName: string;
  shortName: string;
  entryCode: string;
  subtitle: string;
  imageUrl: string;
  description: string;
};

const EMPTY_CUSTOM_FORM: CustomEntryForm = {
  id: null,
  customName: "",
  shortName: "",
  entryCode: "",
  subtitle: "",
  imageUrl: "",
  description: "",
};

export function RoundEntryEditor({
  open,
  onOpenChange,
  round,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  round: EditableRound;
}) {
  const queryClient = useQueryClient();

  const [countryPickerOpen, setCountryPickerOpen] =
    useState(false);

  const [customDialogOpen, setCustomDialogOpen] =
    useState(false);

  const [customForm, setCustomForm] =
    useState<CustomEntryForm>(
      EMPTY_CUSTOM_FORM,
    );

  const {
    data: entries = [],
    isLoading,
  } = useQuery({
    queryKey: [
      "round_entries",
      round?.id ?? null,
    ],

    queryFn: async () => {
      if (!round) {
        return [] as ResolvedEntry[];
      }

      const {
        data: entryRows,
        error: entryError,
      } = await supabase
        .from("round_entries" as any)
        .select(
          `
            id,
            round_id,
            entry_type,
            entry_key,
            country_code,
            custom_name,
            short_name,
            entry_code,
            subtitle,
            image_url,
            description,
            display_order
          `,
        )
        .eq("round_id", round.id)
        .order("display_order");

      if (entryError) {
        throw entryError;
      }

      const countryCodes = Array.from(
        new Set(
          (entryRows ?? [])
            .map(
              (entry: any) =>
                entry.country_code as
                  | string
                  | null,
            )
            .filter(
              (code): code is string =>
                Boolean(code),
            ),
        ),
      );

      const countryMap =
        new Map<string, CountryRecord>();

      if (countryCodes.length > 0) {
        const {
          data: countries,
          error: countryError,
        } = await supabase
          .from("countries")
          .select(
            "code,name,flag,flag_url",
          )
          .in("code", countryCodes);

        if (countryError) {
          throw countryError;
        }

        for (const country of
          countries ?? []) {
          countryMap.set(
            country.code,
            country,
          );
        }
      }

      return sortEntries(
        (entryRows ?? []).map(
          (entry: any) =>
            resolveEntry(
              {
                id: entry.id,
                round_id:
                  entry.round_id,
                entry_type:
                  entry.entry_type,
                entry_key:
                  entry.entry_key,
                country_code:
                  entry.country_code,
                custom_name:
                  entry.custom_name,
                short_name:
                  entry.short_name,
                entry_code:
                  entry.entry_code,
                subtitle:
                  entry.subtitle,
                image_url:
                  entry.image_url,
                description:
                  entry.description,
                display_order:
                  entry.display_order,
              },
              countryMap,
            ),
        ),
      );
    },

    enabled:
      open &&
      Boolean(round?.id),
  });

  const countryCount = useMemo(
    () =>
      entries.filter(
        (entry) =>
          entry.entry_type ===
          "country",
      ).length,
    [entries],
  );

  const customCount = useMemo(
    () =>
      entries.filter(
        (entry) =>
          entry.entry_type ===
          "custom",
      ).length,
    [entries],
  );

  const editable =
    Boolean(round) &&
    round?.status !== "open";

  const invalidate = () => {
    if (round) {
      void queryClient.invalidateQueries({
        queryKey: [
          "round_entries",
          round.id,
        ],
      });
    }

    void queryClient.invalidateQueries({
      queryKey: [
        "round_entry_counts",
      ],
    });

    void queryClient.invalidateQueries({
      queryKey: ["rounds"],
    });

    void queryClient.invalidateQueries({
      queryKey: [
        "public-open-round",
      ],
    });
  };

  const modeFn =
    useServerFn(
      setRoundParticipantMode,
    );

  const saveCustomFn =
    useServerFn(
      saveCustomRoundEntry,
    );

  const deleteCustomFn =
    useServerFn(
      deleteCustomRoundEntry,
    );

  const reorderFn =
    useServerFn(
      reorderRoundEntries,
    );

  const modeMut = useMutation({
    mutationFn: async (
      mode: ParticipantMode,
    ) => {
      if (!round) {
        throw new Error(
          "Round not found",
        );
      }

      await modeFn({
        data: {
          roundId: round.id,
          participantMode: mode,
        },
      });
    },

    onSuccess: () => {
      toast.success(
        "Participant mode updated",
      );
      invalidate();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const customMut = useMutation({
    mutationFn: async (
      form: CustomEntryForm,
    ) => {
      if (!round) {
        throw new Error(
          "Round not found",
        );
      }

      await saveCustomFn({
        data: {
          roundId: round.id,
          id: form.id,
          customName:
            form.customName,
          shortName:
            form.shortName,
          entryCode:
            form.entryCode,
          subtitle: form.subtitle,
          imageUrl: form.imageUrl,
          description:
            form.description,
        },
      });
    },

    onSuccess: () => {
      toast.success(
        customForm.id
          ? "Entry updated"
          : "Entry added",
      );

      setCustomDialogOpen(false);
      setCustomForm(
        EMPTY_CUSTOM_FORM,
      );

      invalidate();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (
      entryId: string,
    ) => {
      if (!round) {
        throw new Error(
          "Round not found",
        );
      }

      await deleteCustomFn({
        data: {
          roundId: round.id,
          entryId,
        },
      });
    },

    onSuccess: () => {
      toast.success(
        "Entry deleted",
      );
      invalidate();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const reorderMut = useMutation({
    mutationFn: async (
      entryIds: string[],
    ) => {
      if (!round) {
        throw new Error(
          "Round not found",
        );
      }

      await reorderFn({
        data: {
          roundId: round.id,
          entryIds,
        },
      });
    },

    onSuccess: () => {
      invalidate();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const requestModeChange = (
    nextMode: ParticipantMode,
  ) => {
    if (!round) return;

    if (
      nextMode ===
        round.participant_mode ||
      modeMut.isPending
    ) {
      return;
    }

    const removesCustom =
      nextMode === "countries" &&
      customCount > 0;

    const removesCountries =
      nextMode === "custom" &&
      countryCount > 0;

    if (
      removesCustom ||
      removesCountries
    ) {
      const what = removesCustom
        ? `${customCount} custom ${
            customCount === 1
              ? "entry"
              : "entries"
          }`
        : `${countryCount} ${
            countryCount === 1
              ? "country"
              : "countries"
          }`;

      const accepted =
        typeof window ===
          "undefined" ||
        window.confirm(
          `Changing to ${
            nextMode === "countries"
              ? "Countries only"
              : "Custom entries only"
          } will remove ${what} from this round. Continue?`,
        );

      if (!accepted) {
        return;
      }
    }

    modeMut.mutate(nextMode);
  };

  const openNewCustomEntry =
    () => {
      setCustomForm(
        EMPTY_CUSTOM_FORM,
      );
      setCustomDialogOpen(true);
    };

  const openEditCustomEntry = (
    entry: ResolvedEntry,
  ) => {
    setCustomForm({
      id: entry.id,
      customName:
        entry.custom_name ?? "",
      shortName:
        entry.short_name ?? "",
      entryCode:
        entry.entry_code ?? "",
      subtitle:
        entry.subtitle ?? "",
      imageUrl:
        entry.image_url ?? "",
      description:
        entry.description ?? "",
    });

    setCustomDialogOpen(true);
  };

  const moveEntry = (
    index: number,
    direction: -1 | 1,
  ) => {
    const targetIndex =
      index + direction;

    if (
      targetIndex < 0 ||
      targetIndex >=
        entries.length
    ) {
      return;
    }

    const ids = entries.map(
      (entry) => entry.id,
    );

    [
      ids[index],
      ids[targetIndex],
    ] = [
      ids[targetIndex],
      ids[index],
    ];

    reorderMut.mutate(ids);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={
          onOpenChange
        }
      >
        <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-4xl flex-col overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 pb-4 pt-5">
            <DialogTitle>
              Entries
              {round
                ? ` · ${round.name}`
                : ""}
            </DialogTitle>

            <DialogDescription>
              Configure countries,
              custom entries, or a
              mixture of both. The
              order shown here is the
              voting order.
            </DialogDescription>
          </DialogHeader>

          {!round ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Round not found.
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-5 p-5">
                {round.status ===
                "open" ? (
                  <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm text-muted-foreground">
                    Close the round
                    before changing
                    participants.
                  </div>
                ) : null}

                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <div className="space-y-1.5">
                    <label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Participant mode
                    </label>

                    <Select
                      value={
                        round.participant_mode
                      }
                      onValueChange={(
                        value,
                      ) =>
                        requestModeChange(
                          value as ParticipantMode,
                        )
                      }
                      disabled={
                        !editable ||
                        modeMut.isPending
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>

                      <SelectContent>
                        <SelectItem value="countries">
                          Countries only
                        </SelectItem>

                        <SelectItem value="custom">
                          Custom entries
                          only
                        </SelectItem>

                        <SelectItem value="mixed">
                          Mixed
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {round.participant_mode !==
                    "custom" ? (
                      <Button
                        variant="outline"
                        onClick={() =>
                          setCountryPickerOpen(
                            true,
                          )
                        }
                        disabled={
                          !editable
                        }
                      >
                        <Globe className="h-4 w-4" />
                        Configure countries
                      </Button>
                    ) : null}

                    {round.participant_mode !==
                    "countries" ? (
                      <Button
                        onClick={
                          openNewCustomEntry
                        }
                        disabled={
                          !editable ||
                          entries.length >=
                            50
                        }
                        className="bg-hero text-primary-foreground shadow-glow"
                      >
                        <Plus className="h-4 w-4" />
                        Add custom entry
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {entries.length} total
                  </Badge>

                  <Badge variant="outline">
                    {countryCount}{" "}
                    {countryCount === 1
                      ? "country"
                      : "countries"}
                  </Badge>

                  <Badge variant="outline">
                    {customCount} custom
                  </Badge>
                </div>

                {isLoading ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    Loading entries…
                  </div>
                ) : entries.length ===
                  0 ? (
                  <div className="rounded-xl border border-dashed border-border p-8 text-center">
                    <p className="font-medium">
                      No entries yet
                    </p>

                    <p className="mt-1 text-sm text-muted-foreground">
                      Add the
                      participants for
                      this round before
                      opening voting.
                    </p>
                  </div>
                ) : (
                  <ol className="space-y-2">
                    {entries.map(
                      (
                        entry,
                        index,
                      ) => (
                        <li
                          key={
                            entry.id
                          }
                          className="glass flex min-w-0 items-center gap-3 rounded-xl px-3 py-3"
                        >
                          <span className="w-7 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                            {index +
                              1}
                          </span>

                          <EntryAvatar
                            entry={
                              entry
                            }
                            size={34}
                          />

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">
                              {getEntryDisplayName(
                                entry,
                              )}
                            </div>

                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                              <span className="uppercase tracking-wider">
                                {entry.entry_type ===
                                "country"
                                  ? "Country"
                                  : "Custom"}
                              </span>

                              {getEntryCode(
                                entry,
                              ) ? (
                                <span className="truncate">
                                  {getEntryCode(
                                    entry,
                                  )}
                                </span>
                              ) : null}

                              {entry.subtitle ? (
                                <span className="truncate">
                                  {
                                    entry.subtitle
                                  }
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              disabled={
                                !editable ||
                                index ===
                                  0 ||
                                reorderMut.isPending
                              }
                              onClick={() =>
                                moveEntry(
                                  index,
                                  -1,
                                )
                              }
                            >
                              <ArrowUp className="h-4 w-4" />
                            </Button>

                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              disabled={
                                !editable ||
                                index ===
                                  entries.length -
                                    1 ||
                                reorderMut.isPending
                              }
                              onClick={() =>
                                moveEntry(
                                  index,
                                  1,
                                )
                              }
                            >
                              <ArrowDown className="h-4 w-4" />
                            </Button>

                            {entry.entry_type ===
                            "custom" ? (
                              <>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  disabled={
                                    !editable
                                  }
                                  onClick={() =>
                                    openEditCustomEntry(
                                      entry,
                                    )
                                  }
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>

                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className={cn(
                                    "h-8 w-8 text-muted-foreground",
                                    "hover:text-destructive",
                                  )}
                                  disabled={
                                    !editable ||
                                    deleteMut.isPending
                                  }
                                  onClick={() => {
                                    const accepted =
                                      typeof window ===
                                        "undefined" ||
                                      window.confirm(
                                        `Delete “${getEntryDisplayName(
                                          entry,
                                        )}” from this round?`,
                                      );

                                    if (
                                      accepted
                                    ) {
                                      deleteMut.mutate(
                                        entry.id,
                                      );
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </li>
                      ),
                    )}
                  </ol>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="border-t border-border px-5 py-3">
            <Button
              variant="outline"
              onClick={() =>
                onOpenChange(false)
              }
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CountryPickerDialog
        open={countryPickerOpen}
        onOpenChange={(nextOpen) => {
          setCountryPickerOpen(
            nextOpen,
          );

          if (!nextOpen) {
            invalidate();
          }
        }}
        roundId={round?.id ?? null}
        roundName={
          round?.name ?? ""
        }
      />

      <CustomEntryDialog
        open={customDialogOpen}
        onOpenChange={(nextOpen) => {
          setCustomDialogOpen(
            nextOpen,
          );

          if (!nextOpen) {
            setCustomForm(
              EMPTY_CUSTOM_FORM,
            );
          }
        }}
        form={customForm}
        setForm={setCustomForm}
        pending={
          customMut.isPending
        }
        onSave={() =>
          customMut.mutate(
            customForm,
          )
        }
      />
    </>
  );
}

function CustomEntryDialog({
  open,
  onOpenChange,
  form,
  setForm,
  pending,
  onSave,
}: {
  open: boolean;
  onOpenChange: (
    open: boolean,
  ) => void;
  form: CustomEntryForm;
  setForm: React.Dispatch<
    React.SetStateAction<CustomEntryForm>
  >;
  pending: boolean;
  onSave: () => void;
}) {
  const update = <
    K extends keyof CustomEntryForm,
  >(
    key: K,
    value: CustomEntryForm[K],
  ) => {
    setForm((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={
        onOpenChange
      }
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {form.id
              ? "Edit custom entry"
              : "Add custom entry"}
          </DialogTitle>

          <DialogDescription>
            Only the display name is
            required. The entry keeps
            a stable internal key even
            if you rename it later.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field
            label="Display name"
            required
          >
            <Input
              value={
                form.customName
              }
              onChange={(event) =>
                update(
                  "customName",
                  event.target.value,
                )
              }
              placeholder="Entry name"
              maxLength={120}
              autoFocus
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Short name">
              <Input
                value={
                  form.shortName
                }
                onChange={(event) =>
                  update(
                    "shortName",
                    event.target
                      .value,
                  )
                }
                placeholder="Optional"
                maxLength={60}
              />
            </Field>

            <Field label="Code">
              <Input
                value={
                  form.entryCode
                }
                onChange={(event) =>
                  update(
                    "entryCode",
                    event.target
                      .value,
                  )
                }
                placeholder="Optional"
                maxLength={24}
              />
            </Field>
          </div>

          <Field label="Subtitle">
            <Input
              value={
                form.subtitle
              }
              onChange={(event) =>
                update(
                  "subtitle",
                  event.target.value,
                )
              }
              placeholder="Artist, delegation, group, etc."
              maxLength={120}
            />
          </Field>

          <Field label="Image URL">
            <Input
              value={
                form.imageUrl
              }
              onChange={(event) =>
                update(
                  "imageUrl",
                  event.target.value,
                )
              }
              placeholder="https://…"
              inputMode="url"
            />
          </Field>

          <Field label="Description">
            <textarea
              value={
                form.description
              }
              onChange={(event) =>
                update(
                  "description",
                  event.target.value,
                )
              }
              placeholder="Optional notes or description"
              maxLength={1000}
              rows={4}
              className={cn(
                "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                "placeholder:text-muted-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() =>
              onOpenChange(false)
            }
          >
            Cancel
          </Button>

          <Button
            onClick={onSave}
            disabled={
              !form.customName.trim() ||
              pending
            }
            className="bg-hero text-primary-foreground shadow-glow"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}

            {form.id
              ? "Save changes"
              : "Add entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </span>

      {children}
    </label>
  );
}
