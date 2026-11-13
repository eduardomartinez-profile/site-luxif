#include <WiFi.h>
#include <PubSubClient.h>
#include <WebSocketsServer.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// Configuração da OLED
#define LARGURA_OLED 128
#define ALTURA_OLED 64
#define OLED_RESET -1
#define OLED_ENDERECO 0x3C

// Wi-Fi (o ESP32 só funciona em redes de 2,4 GHz)
const char* NOME_REDE = "nome-da-rede";
const char* SENHA_REDE = "senha-da-rede";

// Servidor MQTT público: o ESP32 publica as leituras e o site as recebe pela internet
const char* SERVIDOR_MQTT = "broker.hivemq.com";
const char* CANAL_LEITURAS = "ifsp-luxif/leituras";
const char* CANAL_MENSAGENS = "ifsp-luxif/mensagens";
const char* CANAL_RESPOSTAS = "ifsp-luxif/respostas";

// Servidor WebSocket local, no mesmo padrão do servidor do Vinícius (ws://IP/ws, porta 80)
// A biblioteca aceita qualquer caminho, então o site pode usar /ws.
const int PORTA_LOCAL = 80;

Adafruit_SSD1306 display(LARGURA_OLED, ALTURA_OLED, &Wire, OLED_RESET);
WiFiClient conexao;
PubSubClient mqtt(conexao);
WebSocketsServer servidorLocal(PORTA_LOCAL);

// Pinos (o LDR precisa ficar entre o GPIO 32 e o 39, que funcionam junto com o Wi-Fi)
const int PINO_LDR = 34;
const int PINOS_FAIXA[4] = {25, 26, 27, 14};   // Pinos dos resistores de referência
const int PINOS_LED[4] = {16, 17, 18, 19};     // Pinos dos LEDs indicadores de faixa

// Faixas e Valores de Resistores
const long RESISTORES[4] = {1000, 10000, 100000, 470000};
const char* NOMES_FAIXA[4] = {"1k", "10k", "100k", "470k"};

// Limites para troca automática de faixa (Auto-Range). O ADC do ESP32 vai de 0 a 4095.
const int LIMITE_ALTO = 3700;
const int LIMITE_BAIXO = 400;

// Curva do LDR: R = A * lux^(-GAMA). Ajustar conforme calibração.
const float A = 75000.0;
const float GAMA = 0.7;

// Lux que corresponde a 100% no campo "percentage" (mesmo valor do servidor do Vinícius)
const float LUX_MAXIMO_PORCENTAGEM = 200.0;

int faixaAtual = 1;
unsigned long ultimaTentativaMqtt = 0;

void selecionarFaixa(int novaFaixa) {
  for (int i = 0; i < 4; i++) {
    pinMode(PINOS_FAIXA[i], INPUT);
    digitalWrite(PINOS_LED[i], LOW);
  }

  faixaAtual = novaFaixa;
  pinMode(PINOS_FAIXA[faixaAtual], OUTPUT);
  digitalWrite(PINOS_FAIXA[faixaAtual], HIGH);
  digitalWrite(PINOS_LED[faixaAtual], HIGH);
  delay(10);
}

int lerMedia() {
  long soma = 0;
  for (int i = 0; i < 10; i++) {
    soma += analogRead(PINO_LDR);
  }
  return soma / 10;
}

float calcularLux(int leitura) {
  if (leitura >= 4095) return 0;
  if (leitura < 1) leitura = 1;

  float resistenciaLdr = RESISTORES[faixaAtual] * (float) leitura / (4095.0 - (float) leitura);
  return pow(A / resistenciaLdr, 1.0 / GAMA);
}

// Exibe os resultados na OLED
void atualizarOLED(float lux, int leitura) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  // Título
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(F("LUXIF - AUTO RANGE"));

  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);

  // Status da faixa atual e ADC (texto curto para caber nos 128 pixels)
  display.setCursor(0, 14);
  display.print(F("Faixa:"));
  display.print(NOMES_FAIXA[faixaAtual]);
  display.print(F(" ADC:"));
  display.print(leitura);

  // Valor principal em lux ou estado limite
  display.setCursor(0, 28);
  if (leitura > LIMITE_ALTO && faixaAtual == 3) {
    display.setTextSize(2);
    display.println(F("Mto Escuro"));
  } else if (leitura < LIMITE_BAIXO && faixaAtual == 0) {
    display.setTextSize(2);
    display.println(F("Mto Claro"));
  } else {
    display.setTextSize(3);
    display.print(lux, lux < 10 ? 1 : 0);
    display.setTextSize(1);
    display.println(F(" lx"));
  }

  // Rodapé: endereço na rede local (para o site) e "web" quando o MQTT está conectado
  display.setTextSize(1);
  display.setCursor(0, 56);
  display.print(WiFi.localIP());
  if (mqtt.connected()) {
    display.print(F(" web"));
  }

  display.display();
}

// Mensagens do site pela internet: responde no canal de respostas
void aoReceberMqtt(char* canal, byte* dados, unsigned int tamanho) {
  String texto = "";
  for (unsigned int i = 0; i < tamanho; i++) {
    texto += (char) dados[i];
  }
  mqtt.publish(CANAL_RESPOSTAS, texto.c_str());
}

// Mensagens do site pela rede local: devolve o mesmo texto, como o servidor do Vinícius
void aoReceberLocal(uint8_t cliente, WStype_t tipo, uint8_t* dados, size_t tamanho) {
  if (tipo == WStype_TEXT) {
    String texto = "";
    for (size_t i = 0; i < tamanho; i++) {
      texto += (char) dados[i];
    }
    servidorLocal.sendTXT(cliente, texto);
  }
}

// Mantém a conexão com o servidor MQTT, tentando de novo a cada 5 segundos
void manterMqtt() {
  if (mqtt.connected()) {
    mqtt.loop();
    return;
  }

  if (millis() - ultimaTentativaMqtt < 5000) return;
  ultimaTentativaMqtt = millis();

  String identificador = "luxif-" + String(random(1000000));
  if (mqtt.connect(identificador.c_str())) {
    mqtt.subscribe(CANAL_MENSAGENS);
  }
}

void mostrarMensagem(const __FlashStringHelper* texto) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 20);
  display.println(texto);
  display.display();
}

void setup() {
  Serial.begin(115200);

  // Inicialização obrigatória do I2C para o OLED ligar (SDA = GPIO 21, SCL = GPIO 22)
  Wire.begin();

  for (int i = 0; i < 4; i++) {
    pinMode(PINOS_LED[i], OUTPUT);
  }
  selecionarFaixa(faixaAtual);

  // Inicializa o display OLED no endereço 0x3C
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ENDERECO)) {
    Serial.println(F("Falha ao iniciar OLED. Verifique as conexões ou o endereço (0x3C / 0x3D)."));
    while (true) {
      delay(100);
    }
  }

  mostrarMensagem(F("Inicializando LUXIF..."));
  delay(800);

  mostrarMensagem(F("Conectando ao Wi-Fi..."));
  WiFi.begin(NOME_REDE, SENHA_REDE);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
  Serial.print(F("Endereço na rede local: "));
  Serial.println(WiFi.localIP());

  mqtt.setServer(SERVIDOR_MQTT, 1883);
  mqtt.setCallback(aoReceberMqtt);

  servidorLocal.begin();
  servidorLocal.onEvent(aoReceberLocal);
}

void loop() {
  manterMqtt();
  servidorLocal.loop();

  int leitura = lerMedia();

  // Leitura alta: escuro demais para esta faixa, usa resistor maior
  if (leitura > LIMITE_ALTO && faixaAtual < 3) {
    selecionarFaixa(faixaAtual + 1);
    return;
  }

  // Leitura baixa: claro demais para esta faixa, usa resistor menor
  if (leitura < LIMITE_BAIXO && faixaAtual > 0) {
    selecionarFaixa(faixaAtual - 1);
    return;
  }

  float lux = calcularLux(leitura);

  // Atualiza a tela OLED
  atualizarOLED(lux, leitura);

  // Mensagem JSON: "lux" e "percentage" (mesmo formato do servidor do Vinícius) e "faixa" (extra do LUXIF)
  float porcentagem = constrain(lux / LUX_MAXIMO_PORCENTAGEM * 100.0, 0.0, 100.0);
  String mensagem = "{\"lux\":" + String(lux, 1) +
                    ",\"percentage\":" + String(porcentagem, 1) +
                    ",\"faixa\":" + String(faixaAtual) + "}";
  mqtt.publish(CANAL_LEITURAS, mensagem.c_str());
  servidorLocal.broadcastTXT(mensagem);

  // Monitor Serial
  Serial.print(F("Faixa: "));
  Serial.print(NOMES_FAIXA[faixaAtual]);
  Serial.print(F(" | ADC: "));
  Serial.print(leitura);
  Serial.print(F(" | Lux: "));
  Serial.println(lux);

  // Meio segundo entre leituras, para não sobrecarregar o servidor MQTT público
  delay(500);
}
