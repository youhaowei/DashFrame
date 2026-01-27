Feature: Chart Editing: Chart Type Switching
  As a user
  I want to switch between different chart types
  So that I can find the best visualization for my data

  @workflow @visualization
  Scenario: Switch between chart types on visualization page
    Given I am on the DashFrame home page
    When I upload the "sales_data.csv" file
    Then I should be redirected to the insight configuration page
    And I should see chart suggestions
    When I click "Create" on the first suggestion
    Then I should be redirected to the visualization page
    And I should see the chart rendered

    # Switch from initial chart type to Line
    When I change the chart type to "Line"
    Then I should see the chart rendered
    And the chart type should be "Line"

    # Switch to Area
    When I change the chart type to "Area"
    Then I should see the chart rendered
    And the chart type should be "Area"

    # Switch to Scatter
    When I change the chart type to "Scatter"
    Then I should see the chart rendered
    And the chart type should be "Scatter"

    # Switch back to Bar
    When I change the chart type to "Bar"
    Then I should see the chart rendered
    And the chart type should be "Bar"
