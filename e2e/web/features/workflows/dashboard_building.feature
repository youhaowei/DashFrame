Feature: Dashboard Building: Create Dashboard and Add Visualizations
  As a user
  I want to create a dashboard and add visualizations to it
  So that I can organize and view multiple charts together

  @workflow @dashboard
  Scenario: Create a new dashboard and add a visualization
    # First, create a visualization to add to the dashboard
    Given I am on the DashFrame home page
    When I upload the "sales_data.csv" file
    Then I should be redirected to the insight configuration page
    And I should see chart suggestions
    When I click "Create" on the first suggestion
    Then I should be redirected to the visualization page
    And I should see the chart rendered

    # Navigate to dashboards page
    When I navigate to the dashboards page
    Then I should see the dashboards page

    # Create a new dashboard
    When I click the "New Dashboard" button
    Then I should see the create dashboard dialog
    When I enter "Sales Dashboard" as the dashboard name
    And I click the "Create" button in the dialog
    Then I should be redirected to the dashboard detail page
    And I should see the dashboard name "Sales Dashboard"

    # Add a visualization to the dashboard
    When I click the "Edit Dashboard" button
    Then the dashboard should be in edit mode
    When I click the "Add Widget" button
    Then I should see the add widget dialog
    And the "Visualization" widget type should be selected
    When I select the first visualization from the dropdown
    And I click the "Add Widget" button in the dialog
    Then the widget dialog should close
    And I should see a visualization widget on the dashboard

    # Exit edit mode
    When I click the "Done Editing" button
    Then the dashboard should not be in edit mode
