"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import {
    Button,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    Label,
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    ArrowLeft,
    Plus,
    Edit3,
    Check,
    LayoutDashboard,
    FileText,
    BarChart3,
    Toggle,
} from "@dashframe/ui";
import { useDashboardsStore } from "@/lib/stores/dashboards-store";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useShallow } from "zustand/react/shallow";
import { DashboardGrid } from "@/components/dashboards/DashboardGrid";
import type { DashboardItemType } from "@/lib/types/dashboard";

export default function DashboardDetailPage({
    params,
}: {
    params: Promise<{ dashboardId: string }>;
}) {
    const { dashboardId } = use(params);
    const router = useRouter();
    const dashboard = useDashboardsStore((state) =>
        state.dashboards.get(dashboardId),
    );
    const addItem = useDashboardsStore((state) => state.addItem);
    const updateDashboard = useDashboardsStore((state) => state.updateDashboard);
    const visualizations = useVisualizationsStore(
        useShallow((state) => Array.from(state.visualizations.values())),
    );

    const [isEditable, setIsEditable] = useState(false);
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [addType, setAddType] = useState<DashboardItemType>("visualization");
    const [selectedVizId, setSelectedVizId] = useState<string>("");

    // Redirect if not found
    useEffect(() => {
        // We need to wait for hydration
        const timer = setTimeout(() => {
            if (!dashboard) {
                router.push("/dashboards");
            }
        }, 100);
        return () => clearTimeout(timer);
    }, [dashboard, router]);

    if (!dashboard) return null;

    const handleAddItem = () => {
        const newItem = {
            id: crypto.randomUUID(),
            type: addType,
            layout: {
                x: 0,
                y: Infinity, // Put at bottom
                w: addType === "visualization" ? 6 : 4,
                h: addType === "visualization" ? 6 : 4,
            },
            visualizationId:
                addType === "visualization" ? selectedVizId : undefined,
            content: addType === "markdown" ? "## New Text Widget\n\nEdit this text..." : undefined,
        };

        addItem(dashboard.id, newItem);
        setIsAddOpen(false);
        setAddType("visualization");
        setSelectedVizId("");
    };

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="border-border/60 flex items-center justify-between border-b px-6 py-4">
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => router.push("/dashboards")}
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-foreground text-xl font-semibold tracking-tight">
                            {dashboard.name}
                        </h1>
                        <p className="text-muted-foreground text-sm">
                            {dashboard.items.length} items
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isEditable ? (
                        <Button onClick={() => setIsEditable(false)}>
                            <Check className="mr-2 h-4 w-4" />
                            Done Editing
                        </Button>
                    ) : (
                        <Button variant="outline" onClick={() => setIsEditable(true)}>
                            <Edit3 className="mr-2 h-4 w-4" />
                            Edit Dashboard
                        </Button>
                    )}
                    {isEditable && (
                        <Button variant="secondary" onClick={() => setIsAddOpen(true)}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add Widget
                        </Button>
                    )}
                </div>
            </div>

            {/* Grid Content */}
            <div className="flex-1 overflow-y-auto bg-muted/10 p-6">
                <DashboardGrid dashboard={dashboard} isEditable={isEditable} />
            </div>

            {/* Add Widget Dialog */}
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Widget</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Widget Type</Label>
                            <div className="grid grid-cols-2 gap-4">
                                <div
                                    className={`cursor-pointer rounded-lg border p-4 transition-all ${addType === "visualization"
                                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                                            : "hover:border-primary/50"
                                        }`}
                                    onClick={() => setAddType("visualization")}
                                >
                                    <div className="mb-2 flex items-center gap-2 font-medium">
                                        <BarChart3 className="h-4 w-4" />
                                        Visualization
                                    </div>
                                    <p className="text-muted-foreground text-xs">
                                        Add an existing chart or table
                                    </p>
                                </div>
                                <div
                                    className={`cursor-pointer rounded-lg border p-4 transition-all ${addType === "markdown"
                                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                                            : "hover:border-primary/50"
                                        }`}
                                    onClick={() => setAddType("markdown")}
                                >
                                    <div className="mb-2 flex items-center gap-2 font-medium">
                                        <FileText className="h-4 w-4" />
                                        Text / Markdown
                                    </div>
                                    <p className="text-muted-foreground text-xs">
                                        Add rich text, notes, or headers
                                    </p>
                                </div>
                            </div>
                        </div>

                        {addType === "visualization" && (
                            <div className="space-y-2">
                                <Label>Select Visualization</Label>
                                <Select value={selectedVizId} onValueChange={setSelectedVizId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Choose a visualization..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {visualizations.map((viz) => (
                                            <SelectItem key={viz.id} value={viz.id}>
                                                {viz.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleAddItem}
                            disabled={addType === "visualization" && !selectedVizId}
                        >
                            Add Widget
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
