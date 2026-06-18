use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use embedded_svc::wifi::{AuthMethod, ClientConfiguration, Configuration};
use esp_idf_svc::eventloop::EspSystemEventLoop;
use esp_idf_svc::hal::delay::FreeRtos;
use esp_idf_svc::hal::gpio::{PinDriver, Pull};
use esp_idf_svc::hal::peripherals::Peripherals;
use esp_idf_svc::mqtt::client::{EspMqttClient, EventPayload, MqttClientConfiguration, QoS};
use esp_idf_svc::nvs::EspDefaultNvsPartition;
use esp_idf_svc::wifi::{BlockingWifi, EspWifi};
use log::{info, warn};
use serde::Serialize;

const MQTT_CLIENT_ID: &str = "gate-transmitter";
const TRIGGER_TOPIC: &str = "gate/trigger";
const POLL_INTERVAL_MS: u32 = 75;
const GPIO_DEBOUNCE_MS: u32 = 50;
const CYCLE_DURATION: Duration = Duration::from_secs(5);

#[toml_cfg::toml_config]
struct DeviceConfig {
    #[default = ""]
    wifi_ssid: &'static str,
    #[default = ""]
    wifi_password: &'static str,
    #[default = "mqtt://localhost:1883"]
    mqtt_broker_uri: &'static str,
    #[default = ""]
    mqtt_username: &'static str,
    #[default = ""]
    mqtt_password: &'static str,
}

#[derive(Serialize)]
struct TriggerMessage<'a> {
    event: &'a str,
}

enum TransmitterState {
    Idle,
    Buzzing { deadline: Instant },
    Cooldown { deadline: Instant },
}

fn main() -> Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    let peripherals = Peripherals::take()?;
    let mut sensor = PinDriver::input(peripherals.pins.gpio4)?;
    sensor.set_pull(Pull::Down)?;

    let sys_loop = EspSystemEventLoop::take()?;
    let nvs = EspDefaultNvsPartition::take()?;

    let mut wifi = BlockingWifi::wrap(
        EspWifi::new(peripherals.modem, sys_loop.clone(), Some(nvs))?,
        sys_loop,
    )?;
    connect_wifi(&mut wifi)?;

    let mqtt_config = MqttClientConfiguration {
        uri: Some(DeviceConfig::mqtt_broker_uri()),
        client_id: Some(MQTT_CLIENT_ID),
        username: Some(DeviceConfig::mqtt_username()),
        password: Some(DeviceConfig::mqtt_password()),
        ..Default::default()
    };

    let (mut client, mut connection) = EspMqttClient::new(&mqtt_config)
        .context("failed to create MQTT client")?;

    wait_for_mqtt_connection(&mut connection)?;

    let mut state = TransmitterState::Idle;

    loop {
        state = match state {
            TransmitterState::Idle => {
                if debounced_high(&mut sensor)? {
                    publish_trigger(&mut client, "on")?;
                    TransmitterState::Buzzing {
                        deadline: Instant::now() + CYCLE_DURATION,
                    }
                } else {
                    TransmitterState::Idle
                }
            }
            TransmitterState::Buzzing { deadline } => {
                if Instant::now() >= deadline {
                    publish_trigger(&mut client, "off")?;
                    TransmitterState::Cooldown {
                        deadline: Instant::now() + CYCLE_DURATION,
                    }
                } else {
                    TransmitterState::Buzzing { deadline }
                }
            }
            TransmitterState::Cooldown { deadline } => {
                if Instant::now() >= deadline {
                    if sensor.is_high() {
                        publish_trigger(&mut client, "on")?;
                        TransmitterState::Buzzing {
                            deadline: Instant::now() + CYCLE_DURATION,
                        }
                    } else {
                        TransmitterState::Idle
                    }
                } else {
                    TransmitterState::Cooldown { deadline }
                }
            }
        };

        FreeRtos::delay_ms(POLL_INTERVAL_MS);
    }
}

fn connect_wifi(wifi: &mut BlockingWifi<EspWifi<'_>>) -> Result<()> {
    let ssid = DeviceConfig::wifi_ssid();
    let password = DeviceConfig::wifi_password();

    if ssid.is_empty() {
        anyhow::bail!("wifi_ssid is not set — copy cfg.toml.example to cfg.toml");
    }

    let wifi_configuration = Configuration::Client(ClientConfiguration {
        ssid: ssid.try_into().context("invalid wifi_ssid")?,
        password: password.try_into().context("invalid wifi_password")?,
        auth_method: if password.is_empty() {
            AuthMethod::None
        } else {
            AuthMethod::WPA2Personal
        },
        ..Default::default()
    });

    wifi.set_configuration(&wifi_configuration)?;
    wifi.start()?;
    info!("WiFi started");

    wifi.connect()?;
    info!("WiFi connected");

    wifi.wait_netif_up()?;
    info!("WiFi netif up");

    Ok(())
}

fn debounced_high(sensor: &mut PinDriver<'_, esp_idf_svc::hal::gpio::Input>) -> Result<bool> {
    if !sensor.is_high() {
        return Ok(false);
    }

    FreeRtos::delay_ms(GPIO_DEBOUNCE_MS);
    Ok(sensor.is_high())
}

fn publish_trigger(client: &mut EspMqttClient<'_>, event: &str) -> Result<()> {
    let payload = serde_json::to_string(&TriggerMessage { event })?;
    client.publish(TRIGGER_TOPIC, QoS::AtLeastOnce, false, payload.as_bytes())?;
    info!("Published trigger event={event}");
    Ok(())
}

fn wait_for_mqtt_connection(connection: &mut esp_idf_svc::mqtt::client::EspMqttConnection) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(30);

    loop {
        if Instant::now() >= deadline {
            anyhow::bail!("MQTT connection timed out");
        }

        match connection.next() {
            Some(Ok(EventPayload::Connected(_))) => {
                info!("MQTT connected");
                return Ok(());
            }
            Some(Ok(_)) => {}
            Some(Err(err)) => warn!("MQTT connection error: {err:?}"),
            None => FreeRtos::delay_ms(100),
        }
    }
}
