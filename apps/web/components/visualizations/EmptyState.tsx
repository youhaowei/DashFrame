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
                    <p className="text-muted-foreground mt-2 text-base">
                        Connect your data to get started.
                    </p>
                    <div className="bg-muted/50 text-muted-foreground mt-6 max-w-lg rounded-lg p-4 text-sm text-left mx-auto">
                        <p className="mb-2">
                            <strong>Note:</strong> This project is in early development. All data is stored locally in your browser.
                        </p>
                        <p className="mb-2">
                            The server does not process any data, except for proxying Notion API requests to handle CORS.
                        </p>
                        <p>
                            Feedback is appreciated! <a href="https://github.com/youhaowei/DashFrame" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">View on GitHub</a>
                        </p>
                    </div>
                </div>

                <CreateVisualizationContent onComplete={onCreateClick} />
            </div>
        </div>
    );
}
