import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "./table";
import { Badge } from "./badge";
import { Checkbox } from "./checkbox";

const meta = {
  title: "Primitives/Data/Table",
  component: Table,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Alice Johnson</TableCell>
          <TableCell>alice@example.com</TableCell>
          <TableCell>Admin</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Bob Smith</TableCell>
          <TableCell>bob@example.com</TableCell>
          <TableCell>User</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Carol Williams</TableCell>
          <TableCell>carol@example.com</TableCell>
          <TableCell>User</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

export const WithCaption: Story = {
  render: () => (
    <Table>
      <TableCaption>A list of recent users and their roles</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Role</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Alice Johnson</TableCell>
          <TableCell>Active</TableCell>
          <TableCell>Admin</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Bob Smith</TableCell>
          <TableCell>Active</TableCell>
          <TableCell>User</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Carol Williams</TableCell>
          <TableCell>Inactive</TableCell>
          <TableCell>User</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

export const WithBadges: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Project</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead className="text-right">Progress</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">Website Redesign</TableCell>
          <TableCell>
            <Badge variant="default">In Progress</Badge>
          </TableCell>
          <TableCell>
            <Badge variant="destructive">High</Badge>
          </TableCell>
          <TableCell className="text-right">75%</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Mobile App</TableCell>
          <TableCell>
            <Badge variant="secondary">Pending</Badge>
          </TableCell>
          <TableCell>
            <Badge variant="secondary">Medium</Badge>
          </TableCell>
          <TableCell className="text-right">30%</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">API Integration</TableCell>
          <TableCell>
            <Badge variant="outline">Completed</Badge>
          </TableCell>
          <TableCell>
            <Badge variant="outline">Low</Badge>
          </TableCell>
          <TableCell className="text-right">100%</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

export const WithFooter: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Laptop</TableCell>
          <TableCell className="text-right">2</TableCell>
          <TableCell className="text-right">$999.00</TableCell>
          <TableCell className="text-right">$1,998.00</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Mouse</TableCell>
          <TableCell className="text-right">5</TableCell>
          <TableCell className="text-right">$29.99</TableCell>
          <TableCell className="text-right">$149.95</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Keyboard</TableCell>
          <TableCell className="text-right">3</TableCell>
          <TableCell className="text-right">$79.99</TableCell>
          <TableCell className="text-right">$239.97</TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={3}>Total</TableCell>
          <TableCell className="text-right font-bold">$2,387.92</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
};

export const WithCheckboxes: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[50px]">
            <Checkbox />
          </TableHead>
          <TableHead>Task</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Assignee</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>
            <Checkbox />
          </TableCell>
          <TableCell className="font-medium">Update documentation</TableCell>
          <TableCell>
            <Badge variant="default">In Progress</Badge>
          </TableCell>
          <TableCell>Alice Johnson</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>
            <Checkbox />
          </TableCell>
          <TableCell className="font-medium">Fix login bug</TableCell>
          <TableCell>
            <Badge variant="destructive">High Priority</Badge>
          </TableCell>
          <TableCell>Bob Smith</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>
            <Checkbox />
          </TableCell>
          <TableCell className="font-medium">Add new feature</TableCell>
          <TableCell>
            <Badge variant="secondary">Backlog</Badge>
          </TableCell>
          <TableCell>Carol Williams</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

export const DataTable: Story = {
  render: () => (
    <Table>
      <TableCaption>Monthly sales data for Q4 2024</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
          <TableHead className="text-right">Customers</TableHead>
          <TableHead className="text-right">Growth</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">October</TableCell>
          <TableCell className="text-right">$45,231.89</TableCell>
          <TableCell className="text-right">1,234</TableCell>
          <TableCell className="text-right">+12.5%</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">November</TableCell>
          <TableCell className="text-right">$52,789.45</TableCell>
          <TableCell className="text-right">1,456</TableCell>
          <TableCell className="text-right">+16.7%</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">December</TableCell>
          <TableCell className="text-right">$63,421.12</TableCell>
          <TableCell className="text-right">1,789</TableCell>
          <TableCell className="text-right">+20.1%</TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell className="text-right">$161,442.46</TableCell>
          <TableCell className="text-right">4,479</TableCell>
          <TableCell className="text-right">+16.4%</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
};
