Feature: CSV File Upload and Preview
  As a data analyst
  I want to upload CSV files
  So that I can visualize and analyze my data

  @smoke @csv
  Scenario: Upload valid CSV with automatic type inference
    Given I am on the DashFrame home page
    When I click "Add Connection"
    And I select "CSV File" connector
    And I upload "fixtures/sales_data.csv"
    Then I should see a table preview
    And the table should have 100 rows

  @csv @edge-case
  Scenario: Handle CSV with missing values
    Given I am on the DashFrame home page
    When I click "Add Connection"
    And I select "CSV File" connector
    And I upload "fixtures/data_with_nulls.csv"
    Then I should see a table preview
    And missing values should be displayed as empty cells

  @csv @error
  Scenario: Reject empty CSV file
    Given I am on the DashFrame home page
    When I click "Add Connection"
    And I select "CSV File" connector
    And I upload "fixtures/empty.csv"
    Then I should see an error message "File is empty"

  @csv @slow
  Scenario: Upload large CSV file (1000+ rows)
    Given I am on the DashFrame home page
    When I click "Add Connection"
    And I select "CSV File" connector
    And I upload "fixtures/large_dataset.csv"
    Then I should see a table preview
    And the table should have 1000 rows
