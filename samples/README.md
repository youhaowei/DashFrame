# Sample Data: Acme Software Inc.

This sample dataset represents a fictional B2B SaaS company with multiple products. It demonstrates how DashFrame can join data across different domains to unlock powerful cross-functional insights.

## Data Overview

### Company Profile

- **Company**: Acme Software Inc.
- **Products**: 5 SaaS applications (CloudSync Pro, DataVault, TeamFlow, AnalyticsHub, Mobile SDK)
- **Team**: 15 employees across Engineering, Product, Design, Sales, and Operations
- **Customers**: 12 business customers ranging from startups to enterprises

### File Structure

```
samples/
├── Internal Data (Company Operations)
│   ├── employees.json      # Team members, roles, salaries
│   ├── departments.json    # Org structure, budgets
│   ├── projects.json       # Products the company builds
│   ├── sprints.csv         # Engineering velocity metrics
│   ├── expenses.csv        # Operational costs
│   └── revenue.csv         # Revenue by product/channel
│
└── External Data (Product Analytics)
    ├── app-users.json      # Customer accounts
    ├── app-events.csv      # User activity/behavior
    └── subscriptions.csv   # Billing and plans
```

---

## Join Relationships

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ departments │────▶│  employees   │────▶│   sprints   │
│             │     │              │     │             │
│ department_id     │ employee_id  │     │ project_id  │
└─────────────┘     │ department_id│     └──────┬──────┘
      │             │ reports_to   │            │
      │             └──────────────┘            │
      │                    │                    │
      ▼                    ▼                    ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  expenses   │     │   projects   │◀────│   revenue   │
│             │     │              │     │             │
│ department_id     │ project_id   │     │ project_id  │
│ approved_by │────▶│ team_lead    │     └─────────────┘
└─────────────┘     │ product_mgr  │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌─────────────┐  ┌─────────────┐  ┌──────────────┐
   │ app-events  │  │subscriptions│  │  app-users   │
   │             │  │             │  │              │
   │ project_id  │  │ project_id  │  │projects_using│
   │ user_id     │──│ user_id     │──│ user_id      │
   └─────────────┘  └─────────────┘  └──────────────┘
```

---

## Sample Report Ideas

### 1. Executive Dashboard

**Audience**: CEO, Board
**Data Sources**: `revenue.csv`, `expenses.csv`, `subscriptions.csv`

| Metric                | Query Logic                                         |
| --------------------- | --------------------------------------------------- |
| Total MRR             | `SUM(subscriptions.mrr) WHERE status = 'active'`    |
| MRR Growth            | Compare `revenue.total_mrr` month-over-month        |
| Burn Rate             | `SUM(expenses.amount)` by month                     |
| Runway                | Cash balance / monthly burn                         |
| Net Revenue Retention | `(Starting MRR + Expansion - Churn) / Starting MRR` |

**Visualizations**:

- Line chart: MRR trend over time
- Stacked bar: Revenue by product
- Gauge: Burn rate vs budget

---

### 2. Engineering Velocity Report

**Audience**: VP Engineering, Engineering Managers
**Data Sources**: `sprints.csv`, `projects.json`, `employees.json`

| Metric          | Query Logic                                          |
| --------------- | ---------------------------------------------------- |
| Sprint Velocity | `AVG(completed_points)` per project                  |
| Completion Rate | `completed_points / planned_points * 100`            |
| Bug Ratio       | `bugs_found / completed_points`                      |
| Team Efficiency | Points per engineer (`completed_points / team_size`) |

**Visualizations**:

- Line chart: Velocity trend by project
- Scatter plot: Team size vs velocity (diminishing returns?)
- Bar chart: Bug found vs fixed ratio

**Cross-Domain Insight**: Join with `revenue.csv` to calculate **Engineering Cost per MRR Dollar**:

```sql
SELECT
  p.name,
  SUM(e.salary) / 12 as monthly_eng_cost,
  r.total_mrr,
  (SUM(e.salary) / 12) / r.total_mrr as cost_per_mrr_dollar
FROM projects p
JOIN employees e ON e.employee_id = p.team_lead
JOIN revenue r ON r.project_id = p.project_id
GROUP BY p.project_id
```

---

### 3. Customer Health Dashboard

**Audience**: Customer Success, Product
**Data Sources**: `app-users.json`, `app-events.csv`, `subscriptions.csv`

| Metric               | Query Logic                                         |
| -------------------- | --------------------------------------------------- |
| DAU/MAU Ratio        | Daily active / Monthly active users                 |
| Avg Session Duration | `AVG(duration_secs)` from app-events                |
| Feature Adoption     | Count of distinct `event_type` per user             |
| Churn Risk           | Users with declining activity + approaching renewal |

**Visualizations**:

- Heatmap: Activity by hour/day of week
- Cohort chart: Retention by signup month
- Bar chart: Events by type

**Cross-Domain Insight**: Join with `subscriptions.csv` to find **Revenue at Risk**:

```sql
SELECT
  u.company,
  s.mrr,
  COUNT(e.event_id) as events_last_30d,
  CASE WHEN COUNT(e.event_id) < 10 THEN 'High Risk'
       WHEN COUNT(e.event_id) < 50 THEN 'Medium Risk'
       ELSE 'Healthy' END as health_status
FROM app_users u
JOIN subscriptions s ON s.user_id = u.user_id
LEFT JOIN app_events e ON e.user_id = u.user_id
  AND e.timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY u.user_id
ORDER BY s.mrr DESC
```

---

### 4. Product-Market Fit Analysis

**Audience**: Product, Growth
**Data Sources**: `app-users.json`, `subscriptions.csv`, `revenue.csv`

| Metric              | Query Logic                                         |
| ------------------- | --------------------------------------------------- |
| LTV by Segment      | `SUM(mrr) * avg_lifetime` grouped by `company_size` |
| CAC Payback         | Months to recover acquisition cost                  |
| Expansion Revenue % | `expansion_mrr / total_mrr`                         |
| NPS by Plan         | Survey data joined with plan tier                   |

**Visualizations**:

- Bubble chart: Company size vs LTV vs count
- Funnel: Signup source → Trial → Paid → Expansion
- Pie chart: Revenue by industry

**Cross-Domain Insight**: Join with `projects.json` to find **Best Product-Segment Fit**:

```sql
SELECT
  p.name as product,
  u.industry,
  u.company_size,
  COUNT(DISTINCT s.user_id) as customers,
  AVG(s.mrr) as avg_mrr,
  SUM(s.mrr) as total_mrr
FROM subscriptions s
JOIN app_users u ON u.user_id = s.user_id
JOIN projects p ON p.project_id = s.project_id
WHERE s.status = 'active'
GROUP BY p.project_id, u.industry, u.company_size
ORDER BY total_mrr DESC
```

---

### 5. Financial Operations Report

**Audience**: CFO, Finance
**Data Sources**: `expenses.csv`, `departments.json`, `revenue.csv`

| Metric             | Query Logic                                |
| ------------------ | ------------------------------------------ |
| Spend by Category  | `SUM(amount)` grouped by `category`        |
| Budget Utilization | `SUM(expenses) / department.budget_annual` |
| Cost per Employee  | Total dept expenses / headcount            |
| Gross Margin       | `(Revenue - COGS) / Revenue`               |

**Visualizations**:

- Treemap: Expenses by department → category
- Line chart: Cloud costs over time
- Table: Top 10 vendors by spend

**Cross-Domain Insight**: Join with `projects.json` and `revenue.csv` for **Product Profitability**:

```sql
SELECT
  p.name,
  r.total_mrr * 12 as arr,
  SUM(CASE WHEN e.category = 'cloud' THEN e.amount ELSE 0 END) as infra_cost,
  (r.total_mrr * 12 - SUM(e.amount)) as gross_profit
FROM projects p
JOIN revenue r ON r.project_id = p.project_id
JOIN expenses e ON e.description LIKE CONCAT('%', p.name, '%')
GROUP BY p.project_id
```

---

### 6. Sales Performance Dashboard

**Audience**: VP Sales, Account Executives
**Data Sources**: `subscriptions.csv`, `app-users.json`, `revenue.csv`, `employees.json`

| Metric        | Query Logic                       |
| ------------- | --------------------------------- |
| New MRR       | `SUM(new_mrr)` from revenue       |
| Avg Deal Size | `AVG(mrr)` from new subscriptions |
| Win Rate      | Closed won / Total opportunities  |
| Sales Cycle   | Days from signup to paid          |

**Visualizations**:

- Leaderboard: Rep performance
- Funnel: Pipeline stages
- Map: Revenue by country

---

### 7. Cross-Functional OKR Tracker

**Audience**: Leadership Team
**Data Sources**: All files

This report brings together metrics from across the organization:

| Department  | Key Result                   | Data Source         | Target   | Actual  |
| ----------- | ---------------------------- | ------------------- | -------- | ------- |
| Engineering | Ship 100 story points/sprint | `sprints.csv`       | 100      | 94      |
| Product     | Reach 50k MAU on CloudSync   | `app-events.csv`    | 50,000   | 45,000  |
| Sales       | Close $50k new MRR           | `revenue.csv`       | $50,000  | $47,200 |
| Finance     | Keep burn under $100k/mo     | `expenses.csv`      | $100,000 | $98,500 |
| Success     | Maintain <2% monthly churn   | `subscriptions.csv` | 2%       | 1.8%    |

---

## Getting Started

1. **Import the data**: Upload CSV and JSON files as separate data sources
2. **Define joins**: Connect tables using the relationship diagram above
3. **Build visualizations**: Start with the report ideas above
4. **Explore**: Discover your own cross-domain insights!

## Data Quality Notes

- All data is fictional and generated for demonstration purposes
- Dates range from 2022-2024
- Financial figures are in USD
- Some records include churned/inactive status for realistic churn analysis
