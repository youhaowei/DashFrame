Feature: Create Visualization from DataFrame
  As a data analyst
  I want to create visualizations from my data
  So that I can identify patterns and insights

  @smoke @visualization
  Scenario: Create bar chart with default settings
    Given I have uploaded "fixtures/sales_data.csv"
    And I am viewing the data frame
    When I click "Create Visualization"
    And I select "Bar Chart" from the chart type picker
    Then I should see a bar chart
    And the chart should display all data categories

  @visualization @interaction
  Scenario: Interactive chart tooltip
    Given I have a bar chart visualization
    When I hover over the first bar
    Then I should see a tooltip with the exact value
    And the tooltip should show the category name
