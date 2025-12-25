import type {
  NotionDatabase,
  NotionProperty,
} from "@dashframe/connector-notion";
import {
  Card,
  CardContent,
  Button,
  Label,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashframe/ui";

export interface NotionConfigPanelProps {
  /**
   * List of available Notion databases
   */
  databases: NotionDatabase[];
  /**
   * Callback when a database is selected
   */
  onSelectDatabase: (databaseId: string) => void;
  /**
   * Currently selected database ID
   */
  selectedDatabaseId: string | null;
  /**
   * Schema (properties) of the selected database
   */
  schema: NotionProperty[];
  /**
   * IDs of selected properties
   */
  selectedPropertyIds: string[];
  /**
   * Callback when a property is toggled
   */
  onToggleProperty: (propertyId: string) => void;
  /**
   * Whether the schema is currently loading
   */
  isLoadingSchema: boolean;
  /**
   * Callback when the submit button is clicked
   */
  onSubmit: () => void;
  /**
   * Callback when the close button is clicked
   */
  onClose: () => void;
  /**
   * Text for the submit button
   */
  submitLabel?: string;
  /**
   * Whether the submit button is disabled
   */
  submitDisabled?: boolean;
}

/**
 * Panel for configuring Notion database and property selection.
 *
 * Extracted from CreateVisualizationContent for reusability.
 * Handles the Notion-specific configuration flow:
 * 1. Select a database from the list
 * 2. Select properties (fields) from that database
 * 3. Submit to create insight/visualization
 *
 * @example
 * ```tsx
 * <NotionConfigPanel
 *   databases={notionDatabases}
 *   onSelectDatabase={handleSelectDatabase}
 *   selectedDatabaseId={selectedDatabaseId}
 *   schema={databaseSchema}
 *   selectedPropertyIds={selectedPropertyIds}
 *   onToggleProperty={handleToggleProperty}
 *   isLoadingSchema={isLoadingSchema}
 *   onSubmit={handleCreateNotionVisualization}
 *   onClose={() => setShowNotionConfig(false)}
 * />
 * ```
 */
export function NotionConfigPanel({
  databases,
  onSelectDatabase,
  selectedDatabaseId,
  schema,
  selectedPropertyIds,
  onToggleProperty,
  isLoadingSchema,
  onSubmit,
  onClose,
  submitLabel = "Create Table Visualization",
  submitDisabled = false,
}: NotionConfigPanelProps) {
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between px-4 pt-4">
        <div>
          <p className="text-muted-foreground text-xs font-medium">
            Configure Notion insight
          </p>
          <p className="text-foreground text-sm">
            Choose database and properties
          </p>
        </div>
        <Button label="Close" variant="text" size="sm" onClick={onClose} />
      </div>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {/* Database Selector */}
          <div className="space-y-2">
            <Label htmlFor="modal-database">Select Database</Label>
            <Select
              value={selectedDatabaseId || ""}
              onValueChange={onSelectDatabase}
            >
              <SelectTrigger id="modal-database">
                <SelectValue placeholder="Choose a database..." />
              </SelectTrigger>
              <SelectContent>
                {databases.map((db) => (
                  <SelectItem key={db.id} value={db.id}>
                    {db.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Loading State */}
          {isLoadingSchema && (
            <p className="text-muted-foreground text-sm">
              Loading properties...
            </p>
          )}

          {/* Property Selector */}
          {schema.length > 0 && !isLoadingSchema && (
            <div className="space-y-2">
              <Label>Select Properties</Label>
              <div className="border-border max-h-60 space-y-1 overflow-y-auto rounded-md border p-2">
                {schema.map((prop) => (
                  <label
                    key={prop.id}
                    className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm"
                  >
                    <Checkbox
                      checked={selectedPropertyIds.includes(prop.id)}
                      onCheckedChange={() => onToggleProperty(prop.id)}
                    />
                    <span className="flex-1">{prop.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {prop.type}
                    </span>
                  </label>
                ))}
              </div>
              <Button
                label={submitLabel}
                onClick={onSubmit}
                disabled={submitDisabled || selectedPropertyIds.length === 0}
                className="w-full"
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
