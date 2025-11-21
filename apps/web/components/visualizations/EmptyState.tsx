"use client";

import { Sparkles } from "@/components/icons";
import { CreateVisualizationContent } from "./CreateVisualizationContent";

interface EmptyStateProps {
    onCreateClick: () => void;
}

export function EmptyState({ onCreateClick }: EmptyStateProps) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center p-8">
            <div className="border-border/40 bg-card/30 w-full max-w-2xl rounded-3xl border p-8 shadow-sm backdrop-blur-sm">
                <div className="mb-8 text-center">
                    <div className="bg-primary/10 text-primary mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
                        <Sparkles className="h-6 w-6" />
                    </div>
                    <h2 className="text-foreground text-2xl font-semibold tracking-tight">
                        Create your first visualization
                    </h2>
                </div>

                <CreateVisualizationContent onComplete={onCreateClick} />
            </div>
        </div>
    );
}
