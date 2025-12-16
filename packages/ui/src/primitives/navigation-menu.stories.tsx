import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "./navigation-menu";
import {
  Database,
  BarChart3,
  Settings,
  FileText,
  Users,
  Shield,
} from "../lib/icons";

const meta = {
  title: "Primitives/Navigation/NavigationMenu",
  component: NavigationMenu,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof NavigationMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Getting started</NavigationMenuTrigger>
          <NavigationMenuContent>
            <div className="grid w-[400px] gap-3 p-4">
              <NavigationMenuLink href="#">
                <div className="font-medium">Introduction</div>
                <div className="text-muted-foreground text-xs">
                  Learn about DashFrame and its features
                </div>
              </NavigationMenuLink>
              <NavigationMenuLink href="#">
                <div className="font-medium">Installation</div>
                <div className="text-muted-foreground text-xs">
                  How to install and set up DashFrame
                </div>
              </NavigationMenuLink>
              <NavigationMenuLink href="#">
                <div className="font-medium">Quick start</div>
                <div className="text-muted-foreground text-xs">
                  Get up and running in minutes
                </div>
              </NavigationMenuLink>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Components</NavigationMenuTrigger>
          <NavigationMenuContent>
            <div className="grid w-[400px] gap-3 p-4">
              <NavigationMenuLink href="#">
                <div className="font-medium">Alert</div>
                <div className="text-muted-foreground text-xs">
                  Display important messages to users
                </div>
              </NavigationMenuLink>
              <NavigationMenuLink href="#">
                <div className="font-medium">Button</div>
                <div className="text-muted-foreground text-xs">
                  Clickable button component
                </div>
              </NavigationMenuLink>
              <NavigationMenuLink href="#">
                <div className="font-medium">Card</div>
                <div className="text-muted-foreground text-xs">
                  Container for content and actions
                </div>
              </NavigationMenuLink>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Data</NavigationMenuTrigger>
          <NavigationMenuContent>
            <div className="grid w-[500px] grid-cols-2 gap-3 p-4">
              <NavigationMenuLink href="#">
                <Database className="mb-2" />
                <div className="font-medium">Data sources</div>
                <div className="text-muted-foreground text-xs">
                  Connect to CSV, Notion, and more
                </div>
              </NavigationMenuLink>
              <NavigationMenuLink href="#">
                <FileText className="mb-2" />
                <div className="font-medium">DataFrames</div>
                <div className="text-muted-foreground text-xs">
                  Transform and prepare your data
                </div>
              </NavigationMenuLink>
              <NavigationMenuLink href="#">
                <BarChart3 className="mb-2" />
                <div className="font-medium">Visualizations</div>
                <div className="text-muted-foreground text-xs">
                  Create charts and dashboards
                </div>
              </NavigationMenuLink>
              <NavigationMenuLink href="#">
                <Settings className="mb-2" />
                <div className="font-medium">Configuration</div>
                <div className="text-muted-foreground text-xs">
                  Manage settings and preferences
                </div>
              </NavigationMenuLink>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Resources</NavigationMenuTrigger>
          <NavigationMenuContent>
            <div className="grid w-[500px] grid-cols-2 gap-3 p-4">
              <NavigationMenuLink href="#">
                <FileText className="mb-2" />
                <div className="font-medium">Documentation</div>
                <div className="text-muted-foreground text-xs">
                  Complete guides and API reference
                </div>
              </NavigationMenuLink>
              <NavigationMenuLink href="#">
                <Users className="mb-2" />
                <div className="font-medium">Community</div>
                <div className="text-muted-foreground text-xs">
                  Join our community forum
                </div>
              </NavigationMenuLink>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
};

export const SimpleLinks: Story = {
  render: () => (
    <NavigationMenu viewport={false}>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuLink href="#" className="px-4 py-2">
            Dashboard
          </NavigationMenuLink>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink href="#" className="px-4 py-2">
            Insights
          </NavigationMenuLink>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink href="#" className="px-4 py-2">
            Settings
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
};

export const FullApplicationNav: Story = {
  render: () => (
    <div className="bg-card w-full border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <div className="text-lg font-bold">DashFrame</div>
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger>Products</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <div className="grid w-[600px] grid-cols-2 gap-3 p-4">
                    <NavigationMenuLink href="#">
                      <Database className="mb-2" />
                      <div className="font-medium">Data Studio</div>
                      <div className="text-muted-foreground text-xs">
                        Connect and transform your data sources
                      </div>
                    </NavigationMenuLink>
                    <NavigationMenuLink href="#">
                      <BarChart3 className="mb-2" />
                      <div className="font-medium">Analytics</div>
                      <div className="text-muted-foreground text-xs">
                        Create beautiful visualizations
                      </div>
                    </NavigationMenuLink>
                    <NavigationMenuLink href="#">
                      <Shield className="mb-2" />
                      <div className="font-medium">Enterprise</div>
                      <div className="text-muted-foreground text-xs">
                        Advanced security and compliance
                      </div>
                    </NavigationMenuLink>
                    <NavigationMenuLink href="#">
                      <Users className="mb-2" />
                      <div className="font-medium">Collaboration</div>
                      <div className="text-muted-foreground text-xs">
                        Work together with your team
                      </div>
                    </NavigationMenuLink>
                  </div>
                </NavigationMenuContent>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuTrigger>Solutions</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <div className="grid w-[400px] gap-3 p-4">
                    <NavigationMenuLink href="#">
                      <div className="font-medium">For marketers</div>
                      <div className="text-muted-foreground text-xs">
                        Track campaign performance
                      </div>
                    </NavigationMenuLink>
                    <NavigationMenuLink href="#">
                      <div className="font-medium">For analysts</div>
                      <div className="text-muted-foreground text-xs">
                        Deep dive into your data
                      </div>
                    </NavigationMenuLink>
                    <NavigationMenuLink href="#">
                      <div className="font-medium">For executives</div>
                      <div className="text-muted-foreground text-xs">
                        High-level business insights
                      </div>
                    </NavigationMenuLink>
                  </div>
                </NavigationMenuContent>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink href="#" className="px-4 py-2">
                  Pricing
                </NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </div>
      </div>
    </div>
  ),
};
