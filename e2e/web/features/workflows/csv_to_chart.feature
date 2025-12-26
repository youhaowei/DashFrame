Feature: Core Workflow: CSV to Chart
  As a new user
  I want to upload a CSV and create a chart immediately
  So that I can see value in the product quickly

  @core @workflow
  Scenario: Upload CSV and create a suggested chart
    Given I am on the DashFrame home page
    When I upload the "sales_data.csv" file
    Then I should be redirected to the insight configuration page
    And I should see chart suggestions
    When I click "Create" on the first suggestion
    Then I should be redirected to the visualization page
    And I should see the chart rendered
