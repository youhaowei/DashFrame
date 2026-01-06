Feature: Local File Upload
  As a user
  I want to upload CSV and JSON files
  So that I can analyze my local data in DashFrame

  Background:
    Given I am on the DashFrame home page

  @data-source @csv
  Scenario: Upload a CSV file
    When I upload the "sales_data.csv" file
    Then I should be redirected to the insight configuration page
    And I should see the data table with 5 rows
    And I should see columns "Date, Product, Category, Sales, Quantity"

  @data-source @json
  Scenario: Upload a JSON file
    When I upload the "users_data.json" file
    Then I should be redirected to the insight configuration page
    And I should see the data table with 5 rows
    And I should see columns "id, name, email, age, department"

  @data-source @error
  Scenario: Reject unsupported file format
    When I try to upload an unsupported file "document.txt"
    Then I should see an error message containing "Unsupported file format"

  @data-source @error
  Scenario: Reject empty CSV file
    When I try to upload an empty CSV file
    Then I should see an error message containing "CSV file is empty"

  @data-source @error
  Scenario: Reject invalid JSON file
    When I try to upload an invalid JSON file
    Then I should see an error message containing "Invalid JSON format"
