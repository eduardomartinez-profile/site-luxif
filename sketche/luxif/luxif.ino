#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// Configuração da OLED
#define LARGURA_OLED 128
#define ALTURA_OLED 64
#define OLED_RESET -1
#define OLED_ENDERECO 0x3C

Adafruit_SSD1306 display(LARGURA_OLED, ALTURA_OLED, &Wire, OLED_RESET);

// Pinos
const int PINO_LDR = A0;
const int PINOS_FAIXA[4] = {2, 3, 4, 5};    // Pinos dos resistores de referência
const int PINOS_LED[4] = {6, 7, 8, 9};      // Pinos dos LEDs indicadores de faixa

// Faixas e Valores de Resistores
const long RESISTORES[4] = {1000, 10000, 100000, 470000};
const char* NOMES_FAIXA[4] = {"1k", "10k", "100k", "470k"};

// Limites para troca automática de faixa (Auto-Range)
const int LIMITE_ALTO = 920;
const int LIMITE_BAIXO = 100;

// Curva do LDR: R = A * lux^(-GAMA). Ajustar conforme calibração.
const float A = 75000.0;
const float GAMA = 0.7;

int faixaAtual = 1;

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
  if (leitura >= 1023) return 0;
  if (leitura < 1) leitura = 1;

  float resistenciaLdr = RESISTORES[faixaAtual] * (float) leitura / (1023.0 - (float)leitura);
  return pow(A / resistenciaLdr, 1.0 / GAMA);
}

// Exibe os resultados na OLED
void atualizarOLED(float lux, int leitura) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  // Título e Faixa
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(F("LUXIF - AUTO RANGE"));

  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);

  // Status da Faixa Atual e ADC
  display.setCursor(0, 14);
  display.print(F("Faixa: "));
  display.print(NOMES_FAIXA[faixaAtual]);
  display.print(F(" | ADC: "));
  display.print(leitura);

  // Valor principal em Lux ou estado limite
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

  // Rodapé com indicadores visuais de faixa ativa
  display.setTextSize(1);
  display.setCursor(0, 54);
  for (int i = 0; i < 4; i++) {
    if (i == faixaAtual) {
      display.print(F("["));
      display.print(NOMES_FAIXA[i]);
      display.print(F("] "));
    } else {
      display.print(F(" "));
      display.print(NOMES_FAIXA[i]);
      display.print(F("  "));
    }
  }

  display.display();
}

void setup() {
  Serial.begin(9600);
  
  // INICIALIZAÇÃO OBRIGATÓRIA DO I2C PARA O OLED LIGAR
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

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 20);
  display.println(F("Inicializando LUXIF..."));
  display.display();

  delay(800);
}

void loop() {
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

  // Monitor Serial
  Serial.print(F("Faixa: "));
  Serial.print(NOMES_FAIXA[faixaAtual]);
  Serial.print(F(" | ADC: "));
  Serial.print(leitura);
  Serial.print(F(" | Lux: "));
  Serial.println(lux);

  delay(200);
}