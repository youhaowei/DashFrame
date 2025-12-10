"use client";

import * as React from "react";
import {
  ColumnDef,
  SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  More,
  Button,
  Surface,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@dashframe/ui";

interface DataGridProps<TData> {
  data: TData[];
  columns: ColumnDef<TData>[];
  onCreate?: () => void;
  onEdit?: (row: TData) => void;
  onDelete?: (row: TData) => void;
  emptyMessage?: string;
  emptyDescription?: string;
}

export function DataGrid<TData>({
  data,
  columns,
  onCreate,
  onEdit,
  onDelete,
  emptyMessage = "No data available",
  emptyDescription = "Get started by creating a new item.",
}: DataGridProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);

  // Add actions column if edit/delete callbacks are provided
  const columnsWithActions: ColumnDef<TData>[] = React.useMemo(
    () => [
      ...columns,
        ? [
        {
          id: "actions",
          cell: ({ row }: { row: { original: TData } }) => {
            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="h-8 w-8 p-0">
                    import {More} from "@dashframe/ui/icons";
                    <span className="sr-only">Open menu</span>
                    <More className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  {onEdit && (
                    <>
                      <DropdownMenuItem
                        onClick={() => onEdit(row.original)}
                      >
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {onDelete && (
                    <DropdownMenuItem
                      onClick={() => onDelete(row.original)}
                      className="text-destructive"
                    >
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          },
        } as ColumnDef<TData>,
      ]
      : []),
    ],
  [columns, onEdit, onDelete],
  );

  const table = useReactTable({
    data,
    columns: columnsWithActions,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: {
      sorting,
    },
  });

  // Empty state
  if (data.length === 0) {
    return (
      <Surface
        elevation="inset"
        className="flex flex-col items-center justify-center rounded-lg p-12 text-center"
      >
        <p className="text-foreground text-base font-medium">{emptyMessage}</p>
        <p className="text-muted-foreground mt-1 text-sm">{emptyDescription}</p>
        {onCreate && (
          <Button onClick={onCreate} className="mt-4">
            Create New
          </Button>
        )}
      </Surface>
    );
  }

  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columnsWithActions.length}
                  className="h-24 text-center"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
