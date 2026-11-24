<?php
declare(strict_types=1);

// Sello de aprobación sobre el PDF que subió el técnico, con FPDI/FPDF (PHP puro, sin procesos externos).
// El informe original no se modifica: se escribe un archivo nuevo con las mismas páginas más el sello.

/** Texto UTF-8 → Windows-1252, que es lo que entiende la Helvetica estándar de FPDF. */
function texto_pdf(string $t): string
{
    $r = @iconv('UTF-8', 'Windows-1252//TRANSLIT//IGNORE', $t);
    return $r === false ? preg_replace('/[^\x20-\x7E]/', '?', $t) : $r;
}

/** Fecha UTC de MySQL → "24/11/2026 10:32" en hora de Panamá (UTC-5 todo el año). */
function fecha_panama(string $utc): string
{
    return gmdate('d/m/Y H:i', strtotime($utc . ' UTC') - 5 * 3600);
}

/**
 * Escribe en $destino una copia de $origen con el sello de aprobación:
 * recuadro en la primera página y una línea al pie de todas.
 * Lanza una excepción si FPDI no está instalado o no puede leer el PDF.
 */
function sellar_pdf(string $origen, string $destino, string $supervisor, string $aprobadaUtc, string $folio): int
{
    $autoload = dirname(__DIR__) . '/vendor/autoload.php';
    if (!is_file($autoload)) {
        throw new RuntimeException('Falta vendor/ (ejecutar composer install)');
    }
    require_once $autoload;

    $verde = [31, 122, 69];
    $linea = texto_pdf("APROBADO por $supervisor · " . fecha_panama($aprobadaUtc) . " (hora de Panamá) · Informe $folio");

    $pdf = new \setasign\Fpdi\Fpdi();
    $pdf->SetAutoPageBreak(false);
    $paginas = $pdf->setSourceFile($origen);
    for ($i = 1; $i <= $paginas; $i++) {
        $tpl = $pdf->importPage($i);
        $tam = $pdf->getTemplateSize($tpl);
        $ancho = (float) $tam['width'];
        $alto = (float) $tam['height'];
        $pdf->AddPage($tam['orientation'], [$ancho, $alto]);
        $pdf->useTemplate($tpl);

        if ($i === 1) {
            // Recuadro a la derecha de la franja del dictamen (la franja va de y=32 a y=46 mm)
            $w = 82.0; $x = $ancho - 14.0 - $w - 2.0; $y = 34.0; $h = 10.0;
            $pdf->SetFillColor(255, 255, 255);
            $pdf->SetDrawColor(...$verde);
            $pdf->SetLineWidth(0.6);
            $pdf->Rect($x, $y, $w, $h, 'DF');
            $pdf->SetTextColor(...$verde);
            $pdf->SetFont('Helvetica', 'B', 10);
            $pdf->SetXY($x, $y + 0.8);
            $pdf->Cell($w, 4.6, 'APROBADO', 0, 0, 'C');
            $pdf->SetFont('Helvetica', '', 7);
            $pdf->SetXY($x, $y + 5.2);
            $pdf->Cell($w, 3.6, texto_pdf($supervisor . ' · ' . fecha_panama($aprobadaUtc)), 0, 0, 'C');
        }

        // Línea al pie de cada página, bajo la de normas de referencia
        $pdf->SetTextColor(...$verde);
        $pdf->SetFont('Helvetica', 'B', 7);
        $pdf->SetXY(14.0, $alto - 4.2 - 2.0);
        $pdf->Cell($ancho - 28.0, 3.0, $linea, 0, 0, 'C');
    }
    $pdf->Output('F', $destino);
    return $paginas;
}
