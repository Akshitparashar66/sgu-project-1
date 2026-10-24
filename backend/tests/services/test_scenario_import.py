from fastapi.testclient import TestClient

from app.main import app
from app.services.scenario_store import get_scenario
from app.simulation.engine import RunRequest, run_simulation

client = TestClient(app)

# Near N1 (riverside bypass) and N2 (central); shelters near N4 and N6.
ZONES = "Ward,Population,Latitude,Longitude,Reduced mobility share\nSihani ward 7,450,28.7027,77.4126,25\nRNE sector 3,700,28.7040,77.4210,0.1\n"
SHELTERS = "name,capacity,lat,lon\nGovt Inter College,800,28.7120,77.4290\nCommunity hall,500,28.7068,77.4345\n"


def post(**body):
    return client.post("/api/scenarios/import", json={"baseScenarioId": "scenario_a_normal", "name": "Ward 7 pilot", **body})


def test_uploaded_zones_and_shelters_become_a_runnable_scenario():
    response = post(zonesCsv=ZONES, sheltersCsv=SHELTERS)
    body = response.json()

    assert response.status_code == 200, body
    assert body["scenarioId"] == "imported_ward_7_pilot"
    assert body["summary"]["evacuees"] == 1150 and body["summary"]["shelterCapacity"] == 1300
    scenario = get_scenario("imported_ward_7_pilot")
    assert [z.connector_node for z in scenario.zones] == ["N1", "N2"]
    assert scenario.zones[0].movement_profile["reduced_mobility"] == 0.25  # "25" read as a percentage
    assert any(s["id"] == "imported_ward_7_pilot" for s in client.get("/api/scenarios").json())
    run = run_simulation(RunRequest(scenario_id="imported_ward_7_pilot")).metrics
    assert run.evacuated_count + run.unserved_count == 1150


def test_omitted_file_keeps_the_base_scenarios_data():
    body = post(sheltersCsv=SHELTERS).json()
    assert body["summary"]["evacuees"] == 1500  # scenario A's zones


def test_bad_rows_are_reported_by_file_row_and_column():
    response = post(zonesCsv="name,population,lat,lon\nA,many,28.70,77.41\nB,10,95,77.41\n")
    body = response.json()

    assert response.status_code == 422 and body["errorCode"] == "VALIDATION_ERROR"
    fields = {e["field"] for e in body["errors"]}
    assert fields == {"zonesCsv row 2 population", "zonesCsv row 3 lat"}


def test_missing_columns_are_named():
    body = post(sheltersCsv="name,lat,lon\nX,28.7,77.4\n").json()
    assert body["errors"] == [{"field": "sheltersCsv", "message": "missing column(s): capacity"}]


def test_a_place_far_from_the_road_network_is_connected_with_a_warning():
    far = "name,capacity,lat,lon\nNoida stadium,900,28.60,77.35\n"
    body = post(sheltersCsv=far).json()
    assert "km from the nearest road junction" in body["warnings"][0]
