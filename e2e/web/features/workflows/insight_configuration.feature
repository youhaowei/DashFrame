Feature: Insight Configuration: Field Selection, Metrics, and Joins
  As a user
  I want to configure an insight with specific fields, metrics, and joins
  So that I can analyze combined data from multiple sources

  @workflow @insight
  Scenario: Configure insight with field selection, metrics, and joins
    # Upload first CSV and navigate to insight page
    Given I am on the DashFrame home page
    When I upload the "sales_data.csv" file
    Then I should be redirected to the insight configuration page
    And I should see the insight configuration panel

    # Test field selection - select specific fields
    When I select the "Category" field
    And I select the "Sales" field
    Then I should see "Category" in the selected fields
    And I should see "Sales" in the selected fields

    # Test adding a metric
    When I click the add metric button
    And I configure a metric with aggregation "sum" and column "Sales"
    And I save the metric as "Total Sales"
    Then I should see the metric "Total Sales" in the metrics list

    # Upload second CSV for join testing
    When I navigate to the home page
    And I upload the "products_data.csv" file
    Then I should be redirected to the insight configuration page

    # Navigate back to first insight to configure join
    When I navigate to the insights page
    And I click on the first insight
    Then I should be redirected to the insight configuration page

    # Test adding a join
    When I click the add join button
    And I select the products table for the join
    And I configure the join with left field "Product" and right field "Product"
    And I confirm the join
    Then I should see the joined table in the data model
    And I should see combined fields from both tables
