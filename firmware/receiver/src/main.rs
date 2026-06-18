use anyhow::{Context, Result};
use embedded_svc::wifi::{AuthMethod, ClientConfiguration, Configuration};
use esp_idf_svc::eventloop::EspSystemEventLoop;
use esp_idf_svc::hal::delay::FreeRtos;
use esp_idf_svc::hal::gpio::PinDriver;
use esp_idf_svc::hal::peripherals::Peripherals;
use esp_idf_svc::mqtt::client::{EspMqttClient, EventPayload, MqttClientConfiguration, QoS};
use esp_idf_svc::nvs::EspDefaultNvsPartition;
use esp_idf_svc::wifi::{BlockingWifi, EspWifi};
use log::{info, warn};
use serde::Deserialize;

const MQTT_CLIENT_ID: &str = "gate-receiver";
const BUZZER_TOPIC: &str = "gate/buzzer";

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

#[derive(Deserialize)]
struct BuzzerMessage {
    on: bool,
}

fn main() -> Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    let peripherals = Peripherals::take()?;
    let mut buzzer = PinDriver::output(peripherals.pins.gpio5)?;
    buzzer.set_low()?;

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

    client.subscribe(BUZZER_TOPIC, QoS::AtLeastOnce)?;

    loop {
        match connection.next() {
            Some(Ok(EventPayload::Connected(_))) => {
                info!("MQTT connected; subscribed to {BUZZER_TOPIC}");
            }
            Some(Ok(EventPayload::Received { topic, data, .. })) => {
                if topic != BUZZER_TOPIC {
                    continue;
                }

                let payload = std::str::from_utf8(data).context("buzzer payload is not valid UTF-8")?;
                let message: BuzzerMessage = serde_json::from_str(payload)
                    .context("failed to parse buzzer payload")?;

                if message.on {
                    buzzer.set_high()?;
                    info!("Buzzer ON");
                } else {
                    buzzer.set_low()?;
                    info!("Buzzer OFF");
                }
            }
            Some(Ok(_)) => {}
            Some(Err(err)) => warn!("MQTT error: {err:?}"),
            None => FreeRtos::delay_ms(100),
        }
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
