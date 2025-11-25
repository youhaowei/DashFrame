"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@dashframe/convex";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  BarChart3,
  Database,
  FileText,
  Plus,
} from "@dashframe/ui";
import { LuLoader, LuArrowRight } from "react-icons/lu";
import { CreateVisualizationModal } from "@/components/visualizations/CreateVisualizationModal";
import { useState } from "react";

/**
 * Home Dashboard Page
 *
 * Shows overview of data sources, insights, and visualizations.
 * Provides quick links to create and manage entities.
 */
export default function HomePage() {
  const router = useRouter();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Convex queries for counts
  const dataSources = useQuery(api.dataSources.list);
  const insights = useQuery(api.insights.list);
  const visualizations = useQuery(api.visualizations.list);

  // Loading state
  const isLoading =
    dataSources === undefined ||
    insights === undefined ||
    visualizations === undefined;

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <LuLoader className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const stats = [
    {
      title: "Data Sources",
      count: dataSources?.length ?? 0,
      icon: Database,
      href: "/data-sources",
      description: "Connected data sources",
    },
    {
      title: "Insights",
      count: insights?.length ?? 0,
      icon: FileText,
      href: "/insights",
      description: "Configured insights",
    },
    {
      title: "Visualizations",
      count: visualizations?.length ?? 0,
      icon: BarChart3,
      href: "/visualizations",
      description: "Created visualizations",
    },
  ];

  const hasData = (dataSources?.length ?? 0) > 0;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">DashFrame</h1>
              <p className="text-sm text-muted-foreground">
                Build dashboards from your data
              </p>
            </div>
            <Button onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Visualization
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-6 py-6 max-w-4xl space-y-8">
          {/* Stats Grid */}
          <div className="grid gap-4 md:grid-cols-3">
            {stats.map((stat) => (
              <Card
                key={stat.title}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => router.push(stat.href)}
              >
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {stat.title}
                  </CardTitle>
                  <stat.icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stat.count}</div>
                  <p className="text-xs text-muted-foreground">
                    {stat.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {hasData ? (
                <>
                  <Button
                    variant="outline"
                    className="justify-start h-auto p-4"
                    onClick={() => setIsCreateModalOpen(true)}
                  >
                    <div className="flex flex-col items-start text-left">
                      <span className="font-medium">Create visualization</span>
                      <span className="text-xs text-muted-foreground">
                        Build a chart from your data
                      </span>
                    </div>
                    <LuArrowRight className="ml-auto h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start h-auto p-4"
                    onClick={() => router.push("/visualizations")}
                  >
                    <div className="flex flex-col items-start text-left">
                      <span className="font-medium">View visualizations</span>
                      <span className="text-xs text-muted-foreground">
                        See all your charts
                      </span>
                    </div>
                    <LuArrowRight className="ml-auto h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="justify-start h-auto p-4"
                    onClick={() => setIsCreateModalOpen(true)}
                  >
                    <div className="flex flex-col items-start text-left">
                      <span className="font-medium">Upload a CSV</span>
                      <span className="text-xs text-muted-foreground">
                        Get started with local data
                      </span>
                    </div>
                    <LuArrowRight className="ml-auto h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start h-auto p-4"
                    onClick={() => setIsCreateModalOpen(true)}
                  >
                    <div className="flex flex-col items-start text-left">
                      <span className="font-medium">Connect Notion</span>
                      <span className="text-xs text-muted-foreground">
                        Import from Notion databases
                      </span>
                    </div>
                    <LuArrowRight className="ml-auto h-4 w-4" />
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Getting Started (only show when no data) */}
          {!hasData && (
            <Card className="bg-muted/30 border-dashed">
              <CardContent className="p-6 text-center">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Database className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">
                  Welcome to DashFrame
                </h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                  Start by uploading a CSV file or connecting to Notion. Once you have data,
                  you can create insights and visualizations to analyze your information.
                </p>
                <Button onClick={() => setIsCreateModalOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Data Source
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      {/* Create Modal */}
      <CreateVisualizationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
}
