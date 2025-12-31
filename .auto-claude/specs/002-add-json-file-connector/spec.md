# Add JSON File Connector

## Overview
Create a new connector for JSON file uploads that extends the FileSourceConnector base class. Supports both array-of-objects JSON format and nested JSON structures with automatic flattening.


## Rationale

The connector architecture is well-established with BaseConnector, FileSourceConnector, and RemoteApiConnector abstract classes. The CSV connector provides a clear template for implementation. The registry pattern in apps/web/lib/connectors/registry.ts makes adding new connectors trivial - just implement the class and add to allConnectors array.

---
*This spec was created from ideation and is pending detailed specification.*
