import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ScrollArea } from "./scroll-area";
import { Separator } from "./separator";

const meta = {
  title: "Primitives/Layout/ScrollArea",
  component: ScrollArea,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

const longContent = Array.from({ length: 50 }, (_, i) => `Item ${i + 1}`);

export const VerticalScroll: Story = {
  render: () => (
    <ScrollArea className="bg-card h-72 w-80 rounded-md border p-4">
      <div className="space-y-2">
        {longContent.map((item) => (
          <div key={item} className="text-sm">
            {item}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

export const HorizontalScroll: Story = {
  render: () => (
    <ScrollArea className="bg-card w-96 whitespace-nowrap rounded-md border">
      <div className="flex w-max gap-4 p-4">
        {Array.from({ length: 20 }, (_, i) => (
          <div
            key={i}
            className="bg-accent flex h-20 w-40 shrink-0 items-center justify-center rounded-md"
          >
            Card {i + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

export const WithSeparators: Story = {
  render: () => (
    <ScrollArea className="bg-card h-72 w-80 rounded-md border">
      <div className="p-4">
        <h4 className="mb-4 text-sm font-medium leading-none">Tags</h4>
        {Array.from({ length: 30 }, (_, i) => (
          <div key={i}>
            <div className="py-2 text-sm">Tag {i + 1}</div>
            {i < 29 && <Separator />}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

export const LongText: Story = {
  render: () => (
    <ScrollArea className="bg-card h-80 w-96 rounded-md border p-4">
      <div className="space-y-4 text-sm">
        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
          eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad
          minim veniam, quis nostrud exercitation ullamco laboris nisi ut
          aliquip ex ea commodo consequat.
        </p>
        <p>
          Duis aute irure dolor in reprehenderit in voluptate velit esse cillum
          dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non
          proident, sunt in culpa qui officia deserunt mollit anim id est
          laborum.
        </p>
        <p>
          Sed ut perspiciatis unde omnis iste natus error sit voluptatem
          accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae
          ab illo inventore veritatis et quasi architecto beatae vitae dicta
          sunt explicabo.
        </p>
        <p>
          Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut
          fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem
          sequi nesciunt.
        </p>
        <p>
          Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet,
          consectetur, adipisci velit, sed quia non numquam eius modi tempora
          incidunt ut labore et dolore magnam aliquam quaerat voluptatem.
        </p>
      </div>
    </ScrollArea>
  ),
};

export const CodeBlock: Story = {
  render: () => (
    <ScrollArea className="bg-card h-64 w-96 rounded-md border">
      <pre className="p-4 text-xs">
        <code>
          {`function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

const result = fibonacci(10);
console.log(result); // 55

// Example with memoization
const memo = new Map<number, number>();

function fibonacciMemo(n: number): number {
  if (n <= 1) return n;
  if (memo.has(n)) return memo.get(n)!;

  const result = fibonacciMemo(n - 1) + fibonacciMemo(n - 2);
  memo.set(n, result);
  return result;
}

console.log(fibonacciMemo(50)); // Much faster!`}
        </code>
      </pre>
    </ScrollArea>
  ),
};

export const DataTable: Story = {
  render: () => (
    <ScrollArea className="bg-card h-80 w-full max-w-2xl rounded-md border">
      <div className="p-4">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="p-2 text-left font-medium">ID</th>
              <th className="p-2 text-left font-medium">Name</th>
              <th className="p-2 text-left font-medium">Email</th>
              <th className="p-2 text-left font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 30 }, (_, i) => (
              <tr key={i} className="border-b">
                <td className="p-2 text-sm">{i + 1}</td>
                <td className="p-2 text-sm">User {i + 1}</td>
                <td className="p-2 text-sm">user{i + 1}@example.com</td>
                <td className="p-2 text-sm">
                  {i % 3 === 0 ? "Admin" : "User"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ScrollArea>
  ),
};
