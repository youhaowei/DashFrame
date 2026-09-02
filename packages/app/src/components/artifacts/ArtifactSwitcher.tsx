import {
  Button,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wystack/ui-react";
import { CheckIcon, ChevronDownIcon } from "@wystack/ui-react/icons";
import { useId, useState } from "react";

export interface ArtifactSwitchItem {
  id: string;
  name: string;
  description?: string;
  kind?: string;
}

const ALL_KINDS_VALUE = "__all_kinds__";

/** A transient index: browsing another artifact does not change its data definition. */
export function ArtifactSwitcher({
  label,
  items,
  selectedId,
  onSelect,
}: {
  label: string;
  items: ArtifactSwitchItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("");
  const filterId = useId();
  const selected = items.find((item) => item.id === selectedId);
  const kinds = [
    ...new Set(items.flatMap((item) => (item.kind ? [item.kind] : []))),
  ];

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setKind("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            icon={ChevronDownIcon}
            label={`${label}: ${selected?.name ?? "Select"}`}
            className="max-w-full"
          >
            <ChevronDownIcon aria-hidden className="shrink-0" />
            <span className="truncate">{`${label}: ${selected?.name ?? "Select"}`}</span>
          </Button>
        }
      />
      <PopoverContent
        align="start"
        aria-label={label}
        className="w-80 max-w-[calc(100vw-2rem)] p-0"
      >
        <Command label={label}>
          <CommandInput
            placeholder={`Search ${label.toLowerCase()}…`}
            aria-label={`Search ${label.toLowerCase()}`}
          />
          {kinds.length > 1 && (
            <div className="flex items-center gap-2 border-b border-neutral-border px-3 py-2 text-sm">
              <label htmlFor={filterId}>Type</label>
              <Select
                value={kind || ALL_KINDS_VALUE}
                onValueChange={(value) =>
                  setKind(
                    value == null || value === ALL_KINDS_VALUE ? "" : value,
                  )
                }
              >
                <SelectTrigger
                  id={filterId}
                  aria-label="Type"
                  size="sm"
                  className="min-w-0 flex-1"
                >
                  <SelectValue>
                    {(value) =>
                      value === ALL_KINDS_VALUE ? "All types" : value
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_KINDS_VALUE}>All types</SelectItem>
                  {kinds.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <CommandList>
            <CommandEmpty>No matching {label.toLowerCase()}.</CommandEmpty>
            {items
              .filter((item) => !kind || item.kind === kind)
              .map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  keywords={[
                    item.name,
                    item.description ?? "",
                    item.kind ?? "",
                  ]}
                  onSelect={() => {
                    setOpen(false);
                    setKind("");
                    onSelect(item.id);
                  }}
                >
                  <div className="min-w-0 flex-1 py-1">
                    <div className="break-words font-medium">{item.name}</div>
                    {item.description && (
                      <div className="break-words text-xs text-neutral-fg-subtle">
                        {item.description}
                      </div>
                    )}
                  </div>
                  {item.id === selectedId && (
                    <CheckIcon
                      aria-label="Current selection"
                      className="h-4 w-4 shrink-0"
                    />
                  )}
                </CommandItem>
              ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
